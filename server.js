import express from 'express';
const app=express();
app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Strict-Transport-Security','max-age=63072000; includeSubDomains');next();});
const KEY=process.env.RUNWAY_API_KEY;
const VERSION='2024-11-06';
const API='https://api.dev.runwayml.com/v1';
app.use(express.static('public'));
app.get('/api/health',(_,res)=>res.json({ok:true,runway:!!KEY,free:true,images:['pollinations','stable-horde']}));
function validatePrompt(prompt){return typeof prompt==='string'&&prompt.trim().length>=3&&prompt.length<=900;}
app.post('/api/storyboard-image',async(req,res)=>{
 const {prompt,style='Cinematic',engine='pollinations'}=req.body||{};
 if(!validatePrompt(prompt))return res.status(400).json({error:'Enter a scene description between 3 and 900 characters.'});
 const description=style+' storyboard illustration, cinematic composition, scene: '+prompt.trim()+', no text, no watermark';
 if(engine!=='horde'){
  const imageUrl='https://image.pollinations.ai/prompt/'+encodeURIComponent(description);
  return res.json({imageUrl,engine:'pollinations'});
 }
 try{
  const headers={'Content-Type':'application/json','apikey':process.env.STABLE_HORDE_API_KEY||'0000000000','Client-Agent':'DreamMotion:1.0:public'};
  const submit=await fetch('https://stablehorde.net/api/v2/generate/async',{method:'POST',headers,body:JSON.stringify({prompt:description,params:{width:768,height:512,steps:20,cfg_scale:7,sampler_name:'k_euler'},models:['stable_diffusion'],nsfw:false,censor_nsfw:true}),signal:AbortSignal.timeout(30000)});
  const job=await submit.json().catch(()=>({}));
  if(!submit.ok||!job.id)return res.status(502).json({error:job.message||'Stable Horde could not accept the image request. Try Pollinations instead.'});
  for(let attempt=0;attempt<40;attempt++){
   await new Promise(resolve=>setTimeout(resolve,3000));
   const check=await fetch('https://stablehorde.net/api/v2/generate/status/'+encodeURIComponent(job.id),{headers:{'Client-Agent':'DreamMotion:1.0:public'},signal:AbortSignal.timeout(20000)});
   const state=await check.json().catch(()=>({}));
   if(!check.ok)return res.status(502).json({error:'Stable Horde status check failed. Try another picture engine.'});
   const generated=state.generations?.[0]?.img;
   if(generated)return res.json({imageUrl:'data:image/webp;base64,'+generated,engine:'stable-horde'});
   if(state.faulted)return res.status(502).json({error:'Stable Horde could not generate this picture. Try Pollinations.'});
  }
  return res.status(504).json({error:'Stable Horde is busy and the picture is taking too long. Switch to Pollinations or retry.'});
 }catch(error){
  console.error('Stable Horde image error:',error.name,error.message);
  return res.status(502).json({error:'Could not connect to Stable Horde. Try Pollinations instead.'});
 }
});
app.post('/api/generate',async(req,res)=>{if(!KEY)return res.status(503).json({error:'Runway is not configured. Add RUNWAY_API_KEY in Render environment settings.'});const {prompt,style='Cinematic',duration=5,ratio='1280:720',model='gen4_turbo'}=req.body||{};if(!validatePrompt(prompt))return res.status(400).json({error:'Prompt must contain 3–900 characters.'});if(![5,10].includes(Number(duration)))return res.status(400).json({error:'Clip duration must be 5 or 10 seconds.'});if(!['1280:720','720:1280','960:960'].includes(ratio))return res.status(400).json({error:'Unsupported aspect ratio.'});if(!['gen4_turbo','gen4.5','seedance2_5'].includes(model))return res.status(400).json({error:'Unsupported video model.'});try{const response=await fetch(API+'/text_to_video',{method:'POST',headers:{Authorization:'Bearer '+KEY,'X-Runway-Version':VERSION,'Content-Type':'application/json'},body:JSON.stringify({model,promptText:'Visual style: '+style+'. '+prompt.trim()+'. No watermark, no logo, no text overlay.',duration:Number(duration),ratio}),signal:AbortSignal.timeout(45000)});const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:data.error||data.message||'Runway rejected the request. Check API access and credits.'});res.json({taskId:data.id||data.taskId});}catch(error){console.error('Runway submit:',error.message);res.status(502).json({error:'Could not reach Runway. Please retry.'});}});
app.get('/api/task/:id',async(req,res)=>{if(!KEY)return res.status(503).json({error:'Runway is not configured.'});try{const response=await fetch(API+'/tasks/'+encodeURIComponent(req.params.id),{headers:{Authorization:'Bearer '+KEY,'X-Runway-Version':VERSION},signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:data.error||data.message||'Task status unavailable.'});res.json(data);}catch(error){res.status(502).json({error:'Could not check video status.'});}});
app.post('/api/free-video',async(req,res)=>{const {prompt,style='Cinematic',ratio='1280:720',duration=5}=req.body||{};if(!validatePrompt(prompt))return res.status(400).json({error:'Prompt must contain 3–900 characters.'});if(!['1280:720','720:1280','960:960'].includes(ratio))return res.status(400).json({error:'Unsupported aspect ratio.'});if(![5,10].includes(Number(duration)))return res.status(400).json({error:'Clip duration must be 5 or 10 seconds.'});const [width,height]=ratio.split(':').map(Number);const seconds=Math.min(8.5,Math.max(3,Number(duration)||5));const data=['Visual style: '+style+'. '+prompt.trim()+'. No watermark, no logo, no text overlay.','worst quality, blurry, distorted, watermark, logo, text overlay',null,null,height,width,'text-to-video',7,seconds,0,42,true,1,true];const headers={'Content-Type':'application/json'};if(process.env.HF_TOKEN)headers.Authorization='Bearer '+process.env.HF_TOKEN;const base='https://lightricks-ltx-video-distilled.hf.space';try{const submit=await fetch(base+'/gradio_api/call/text_to_video',{method:'POST',headers,body:JSON.stringify({data}),signal:AbortSignal.timeout(45000)});const raw=await submit.text();if(!submit.ok){console.error('LTX submit',submit.status,raw.slice(0,400));return res.status(502).json({error:'Free video engine rejected the request ('+submit.status+'). Try again later.'});}let task;try{task=JSON.parse(raw);}catch{return res.status(502).json({error:'Free engine returned an invalid response.'});}if(!task.event_id)return res.status(502).json({error:'Free engine did not provide a task ID.'});const result=await fetch(base+'/gradio_api/call/text_to_video/'+encodeURIComponent(task.event_id),{headers,signal:AbortSignal.timeout(240000)});const events=await result.text();if(!result.ok)return res.status(502).json({error:'Free engine could not retrieve the result ('+result.status+').'});let videoUrl=null;for(const block of events.split(/\n\n/)){const event=block.match(/^event:\s*(\S+)/m),match=block.match(/^data:\s*(.+)$/m);if(!event||!match)continue;if(event[1]==='error')return res.status(502).json({error:'Free engine reported a rendering error.'});if(event[1]==='complete'){try{const payload=JSON.parse(match[1]);const file=payload?.[0];videoUrl=file?.video?.url||file?.url||file?.path||null;}catch{}break;}}if(!videoUrl)return res.status(502).json({error:'The free model did not return a video. It may be busy or unavailable.'});res.json({videoUrl,free:true});}catch(error){console.error('LTX render:',error.name,error.message);res.status(502).json({error:error.name==='TimeoutError'?'Free video engine timed out. Try again.':'Could not connect to the free video engine.'});}});
const port=process.env.PORT||3000;app.listen(port,()=>console.log('DreamMotion Studio listening on '+port));
