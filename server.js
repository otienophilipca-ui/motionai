import express from 'express';
const app=express(); app.use(express.json({limit:'1mb'}));
const KEY=process.env.RUNWAY_API_KEY;
const VERSION=process.env.RUNWAY_API_VERSION||'2024-11-06';
app.use(express.static('public'));
app.get('/api/health',(_,res)=>res.json({ok:true,configured:!!KEY}));
app.post('/api/generate',async(req,res)=>{
 if(!KEY)return res.status(503).json({error:'Server is missing RUNWAY_API_KEY. Add it in hosting environment settings.'});
 const {prompt,style='Cinematic',duration=5,ratio='1280:720'}=req.body||{};
 if(typeof prompt!=='string'||prompt.trim().length<3)return res.status(400).json({error:'Please enter a more detailed prompt.'});
 const fullPrompt=`${style} style. ${prompt.trim()}`;
 try{
  const r=await fetch('https://api.dev.runwayml.com/v1/text_to_video',{method:'POST',headers:{'Authorization':`Bearer ${KEY}`,'X-Runway-Version':VERSION,'Content-Type':'application/json'},body:JSON.stringify({model:'gen4_turbo',promptText:fullPrompt,duration:Number(duration),ratio})});
  const data=await r.json(); if(!r.ok)return res.status(r.status).json({error:data?.error||data?.message||JSON.stringify(data)});
  res.json({taskId:data.id||data.taskId,task:data});
 }catch(e){res.status(500).json({error:e.message||'Request failed'});}
});
app.get('/api/task/:id',async(req,res)=>{
 if(!KEY)return res.status(503).json({error:'Server is missing RUNWAY_API_KEY.'});
 try{const r=await fetch(`https://api.dev.runwayml.com/v1/tasks/${encodeURIComponent(req.params.id)}`,{headers:{'Authorization':`Bearer ${KEY}`,'X-Runway-Version':VERSION}});const data=await r.json();if(!r.ok)return res.status(r.status).json({error:data?.error||data?.message||JSON.stringify(data)});res.json(data);}catch(e){res.status(500).json({error:e.message||'Polling failed'});}
});
const port=process.env.PORT||3000;app.listen(port,()=>console.log(`DreamMotion AI listening on ${port}`));
