import express from 'express';
const app = express();
app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{
 res.setHeader('Strict-Transport-Security','max-age=63072000; includeSubDomains');
 next();
});
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
  const payload={model,promptText:`Visual style: ${style}. ${prompt.trim()}. No watermark, no logo, no text overlay.`,duration:Number(duration),ratio};
  const r=await fetch(API+'/text_to_video',{method:'POST',headers:{Authorization:`Bearer ${KEY}`,'X-Runway-Version':VERSION,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await r.json().catch(()=>({}));
  if(!r.ok)return res.status(r.status).json({error:data?.error||data?.message||'Runway rejected the request. Check API credits and model options.'});
  res.json({taskId:data.id||data.taskId});
 } catch(e){res.status(502).json({error:'Could not reach the video provider. Please retry.'});}
});

// Lightweight storyboard still-image endpoint: generate visual thumbnails using remote image prompt service.
app.post('/api/storyboard-image',async(req,res)=>{
 const {prompt,style='Cinematic'}=req.body||{};
 if(typeof prompt!=='string'||prompt.trim().length<3)return res.status(400).json({error:'Provide a scene description.'});
 // Use a public image endpoint only as a thumbnail preview; prompt is encoded for URL safety.
 const imageUrl='https://image.pollinations.ai/prompt/'+encodeURIComponent(style+' storyboard frame, scene illustration: '+prompt.trim()+' no text, no watermark');
 res.json({imageUrl});
});

// Reinitialized free LTX video integration via Hugging Face Gradio API.
app.post('/api/free-video',async(req,res)=>{
 const {prompt,style='Cinematic',ratio='1280:720',duration=5}=req.body||{};
 if(typeof prompt!=='string'||prompt.trim().length<3)return res.status(400).json({error:'Please enter a video description.'});
 if(prompt.length>900)return res.status(400).json({error:'Prompt too long.'});
 const [width,height]=ratio.split(':').map(Number);
 if(![1280,720,960].includes(width)||![720,1280,960].includes(height))return res.status(400).json({error:'Invalid video dimensions.'});
 const seconds=Math.min(8.5,Math.max(3,Number(duration)||5));
 const data=[`Visual style: ${style}. ${prompt.trim()}. No watermark, no logo, no text overlay.`,'worst quality, blurry, distorted, watermark, logo, text overlay',null,null,height,width,'text-to-video',7,seconds,0,42,true,1,true];
 const headers={'Content-Type':'application/json'};if(process.env.HF_TOKEN)headers.Authorization='Bearer '+process.env.HF_TOKEN;
 const base='https://lightricks-ltx-video-distilled.hf.space';
 try{
  const submit=await fetch(base+'/gradio_api/call/text_to_video',{method:'POST',headers,body:JSON.stringify({data}),signal:AbortSignal.timeout(45000)});
  const submitText=await submit.text();if(!submit.ok){console.error('Free engine submit error',submit.status,submitText.slice(0,500));return res.status(502).json({error:'Free engine rejected submission ('+submit.status+'). Try again shortly.'});}
  let parsed;try{parsed=JSON.parse(submitText);}catch{console.error('Free engine submit malformed response',submitText.slice(0,500));return res.status(502).json({error:'Free engine returned an invalid task response.'});}
  const eventId=parsed.event_id;if(!eventId)return res.status(502).json({error:'Free engine did not return a task ID.'});
  const result=await fetch(base+'/gradio_api/call/text_to_video/'+encodeURIComponent(eventId),{headers,signal:AbortSignal.timeout(240000)});
  const raw=await result.text();if(!result.ok){console.error('Free engine wait error',result.status,raw.slice(0,500));return res.status(502).json({error:'Free engine could not retrieve render ('+result.status+').'});}
  const blocks=raw.split(/\n\n/).filter(Boolean);let output=null,detail='';
  for(const block of blocks){const ev=block.match(/^event:\s*(\S+)/m),dm=block.match(/^data:\s*(.+)$/m);if(!ev||!dm)continue;if(ev[1]==='error'){detail=dm[1];break;}if(ev[1]==='complete'){try{const payload=JSON.parse(dm[1]);const vf=payload?.[0];output=vf?.video?.url||vf?.url||vf?.path||null;}catch(e){detail=e.message;}break;}}
  if(output)return res.json({videoUrl:output,free:true});console.error('Free engine completed without output',detail,raw.slice(-1000));return res.status(502).json({error:'Free engine did not return a video. The hosted model may be unavailable or busy.'});
 }catch(e){console.error('Free engine exception',e.name,e.message);return res.status(502).json({error:e.name==='TimeoutError'?'Free engine timed out. Try again.':'Free engine connection failed. Try again later.'});}
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
