import express from 'express';
const app = express();
app.use(express.json({limit:'1mb'}));
const KEY = process.env.RUNWAY_API_KEY;
const VERSION = '2024-11-06';
const API = 'https://api.dev.runwayml.com/v1';
app.use(express.static('public'));
app.get('/api/health', (_,res)=>res.json({ok:true,configured:!!KEY}));
app.post('/api/generate', async (req,res)=>{
 if(!KEY) return res.status(503).json({error:'Video engine is not configured. Add RUNWAY_API_KEY in Render Environment settings.'});
 const {prompt,style='Cinematic',duration=5,ratio='1280:720',model='gen4_turbo'}=req.body||{};
 if(typeof prompt!=='string'||prompt.trim().length<3) return res.status(400).json({error:'Please enter a video description (at least 3 characters).'});
 if(prompt.length>900) return res.status(400).json({error:'Prompt is too long. Keep it under 900 characters.'});
 if(![5,10].includes(Number(duration))) return res.status(400).json({error:'Choose 5 or 10 seconds.'});
 if(!['1280:720','720:1280','960:960'].includes(ratio)) return res.status(400).json({error:'Unsupported video aspect ratio.'});
 if(!['gen4_turbo','gen4.5','seedance2_5'].includes(model)) return res.status(400).json({error:'Unsupported model.'});
 try {
  const payload={model,promptText:`Visual style: ${style}. ${prompt.trim()}`,duration:Number(duration),ratio};
  const r=await fetch(API+'/text_to_video',{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'X-Runway-Version':VERSION,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)return res.status(r.status).json({error:data?.error||data?.message||'Runway rejected the request. Check API credits and model options.'});
  res.json({taskId:data.id||data.taskId});
 } catch(e){res.status(502).json({error:'Could not reach the video provider. Please retry.'});}
});
app.get('/api/task/:id',async(req,res)=>{
 if(!KEY)return res.status(503).json({error:'Video engine is not configured.'});
 try{
  const r=await fetch(API+'/tasks/'+encodeURIComponent(req.params.id),{headers:{Authorization:`Bearer ${KEY}`,'X-Runway-Version':VERSION}});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)return res.status(r.status).json({error:data?.error||data?.message||'Task status unavailable.'});
  res.json(data);
 }catch(e){res.status(502).json({error:'Could not check render status. Retry shortly.'});}
});
const port=process.env.PORT||3000;
app.listen(port,()=>console.log('DreamMotion AI listening on '+port));
