import express from 'express';
const app=express();
app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');res.setHeader('Strict-Transport-Security','max-age=63072000; includeSubDomains');next();});
const KEY=process.env.RUNWAY_API_KEY;
const VERSION='2024-11-06';
const API='https://api.dev.runwayml.com/v1';
app.use(express.static('public'));
app.get('/api/health',(_,res)=>res.json({ok:true,runway:!!KEY,free:true,images:['pollinations','stable-horde'],video:['ltx','wan-2.2'],narration:['browser-speech','kokoro-mp3']}));
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
   if(generated)return res.json({imageUrl:'data:image/png;base64,'+generated,engine:'stable-horde'});
   if(state.faulted)return res.status(502).json({error:'Stable Horde could not generate this picture. Try Pollinations.'});
  }
  return res.status(504).json({error:'Stable Horde is busy and the picture is taking too long. Switch to Pollinations or retry.'});
 }catch(error){
  console.error('Stable Horde image error:',error.name,error.message);
  return res.status(502).json({error:'Could not connect to Stable Horde. Try Pollinations instead.'});
 }
});

app.post('/api/wan-video',async(req,res)=>{
 const {prompt,style='Cinematic',imageUrl,duration=5}=req.body||{};
 if(!validatePrompt(prompt))return res.status(400).json({error:'Prompt must contain 3–900 characters.'});
 if(typeof imageUrl!=='string'||(!imageUrl.startsWith('https://')&&!imageUrl.startsWith('data:image/')))return res.status(400).json({error:'A storyboard image is required for Wan 2.2.'});
 const base='https://zerogpu-aoti-wan2-2-fp8da-aoti-faster.hf.space';
 try{
  let bytes, mime='image/png';
  if(imageUrl.startsWith('data:image/')){
   const m=imageUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
   if(!m)return res.status(400).json({error:'Invalid storyboard image.'});
   mime=m[1];bytes=Buffer.from(m[2],'base64');
  }else{
   const imageResponse=await fetch(imageUrl,{signal:AbortSignal.timeout(30000)});
   if(!imageResponse.ok)return res.status(502).json({error:'Could not retrieve the storyboard image.'});
   mime=imageResponse.headers.get('content-type')||mime;bytes=Buffer.from(await imageResponse.arrayBuffer());
  }
  if(bytes.length>12*1024*1024)return res.status(413).json({error:'Storyboard image is too large.'});
  const form=new FormData();form.append('files',new Blob([bytes],{type:mime}),'dreammotion-frame.png');
  const upload=await fetch(base+'/gradio_api/upload',{method:'POST',body:form,signal:AbortSignal.timeout(45000)});
  const paths=await upload.json().catch(()=>[]);
  if(!upload.ok||!Array.isArray(paths)||!paths[0])return res.status(502).json({error:'Wan 2.2 could not accept the storyboard image. Try LTX Video.'});
  const path=paths[0];
  const file={path,url:base+'/gradio_api/file='+path,orig_name:'dreammotion-frame.png',mime_type:mime,meta:{_type:'gradio.FileData'}};
  const text=style+' animated cinematic scene: '+prompt.trim()+'. Natural movement, consistent characters, no captions, no watermark.';
  const submit=await fetch(base+'/gradio_api/call/generate_video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:[file,text,4,'blurry, distorted, watermark, text overlay',Math.min(5,Math.max(2,Number(duration)||5)),1,1,42,true]}),signal:AbortSignal.timeout(45000)});
  const task=await submit.json().catch(()=>({}));
  if(!submit.ok||!task.event_id)return res.status(502).json({error:'Wan 2.2 is unavailable or busy. Try LTX Video instead.'});
  const result=await fetch(base+'/gradio_api/call/generate_video/'+encodeURIComponent(task.event_id),{signal:AbortSignal.timeout(300000)});
  const events=await result.text();
  if(!result.ok)return res.status(502).json({error:'Wan 2.2 could not finish the render. Try again later.'});
  let output=null;
  for(const block of events.split(/\n\n/)){
   const ev=block.match(/^event:\s*(\S+)/m),data=block.match(/^data:\s*(.+)$/m);
   if(!ev||!data)continue;
   if(ev[1]==='error')return res.status(502).json({error:'Wan 2.2 reported a rendering error. Try LTX Video.'});
   if(ev[1]==='complete'){try{const parsed=JSON.parse(data[1]);const item=parsed?.[0];output=item?.video?.url||item?.url||item?.path||null;}catch{}break;}
  }
  if(!output)return res.status(502).json({error:'Wan 2.2 returned no video. Try again later.'});
  if(output.startsWith('/'))output=base+'/gradio_api/file='+output;
  res.json({videoUrl:output,engine:'wan-2.2',free:true});
 }catch(error){
  console.error('Wan video:',error.name,error.message);
  res.status(502).json({error:error.name==='TimeoutError'?'Wan 2.2 timed out. Try LTX Video or retry later.':'Could not connect to the Wan 2.2 community engine.'});
 }
});

app.post('/api/generate',async(req,res)=>{if(!KEY)return res.status(503).json({error:'Runway is not configured. Add RUNWAY_API_KEY in Render environment settings.'});const {prompt,style='Cinematic',duration=5,ratio='1280:720',model='gen4_turbo'}=req.body||{};if(!validatePrompt(prompt))return res.status(400).json({error:'Prompt must contain 3–900 characters.'});if(![5,10].includes(Number(duration)))return res.status(400).json({error:'Clip duration must be 5 or 10 seconds.'});if(!['1280:720','720:1280','960:960'].includes(ratio))return res.status(400).json({error:'Unsupported aspect ratio.'});if(!['gen4_turbo','gen4.5','seedance2_5'].includes(model))return res.status(400).json({error:'Unsupported video model.'});try{const response=await fetch(API+'/text_to_video',{method:'POST',headers:{Authorization:'Bearer '+KEY,'X-Runway-Version':VERSION,'Content-Type':'application/json'},body:JSON.stringify({model,promptText:'Visual style: '+style+'. '+prompt.trim()+'. No watermark, no logo, no text overlay.',duration:Number(duration),ratio}),signal:AbortSignal.timeout(45000)});const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:data.error||data.message||'Runway rejected the request. Check API access and credits.'});res.json({taskId:data.id||data.taskId});}catch(error){console.error('Runway submit:',error.message);res.status(502).json({error:'Could not reach Runway. Please retry.'});}});
app.get('/api/task/:id',async(req,res)=>{if(!KEY)return res.status(503).json({error:'Runway is not configured.'});try{const response=await fetch(API+'/tasks/'+encodeURIComponent(req.params.id),{headers:{Authorization:'Bearer '+KEY,'X-Runway-Version':VERSION},signal:AbortSignal.timeout(20000)});const data=await response.json().catch(()=>({}));if(!response.ok)return res.status(response.status).json({error:data.error||data.message||'Task status unavailable.'});res.json(data);}catch(error){res.status(502).json({error:'Could not check video status.'});}});
app.post('/api/free-video',async(req,res)=>{const {prompt,style='Cinematic',ratio='1280:720',duration=5}=req.body||{};if(!validatePrompt(prompt))return res.status(400).json({error:'Prompt must contain 3–900 characters.'});if(!['1280:720','720:1280','960:960'].includes(ratio))return res.status(400).json({error:'Unsupported aspect ratio.'});if(![5,10].includes(Number(duration)))return res.status(400).json({error:'Clip duration must be 5 or 10 seconds.'});const [width,height]=ratio.split(':').map(Number);const seconds=Math.min(8.5,Math.max(3,Number(duration)||5));const data=[style+' cinematic video: '+prompt.trim()+'. No watermark, no logo, no text overlay.','worst quality, blurry, distorted, watermark, logo, text overlay',null,null,height,width,'text-to-video',seconds,9,42,true,3,false];const base='https://lightricks-ltx-video-distilled.hf.space';const headers={'Content-Type':'application/json'};if(process.env.HF_TOKEN)headers.Authorization='Bearer '+process.env.HF_TOKEN;try{const submit=await fetch(base+'/gradio_api/call/generate',{method:'POST',headers,body:JSON.stringify({data}),signal:AbortSignal.timeout(45000)});const raw=await submit.text();if(!submit.ok){console.error('LTX submit',submit.status,raw.slice(0,500));return res.status(502).json({error:'LTX rejected the request ('+submit.status+'). '+raw.slice(0,180)});}let task;try{task=JSON.parse(raw);}catch{return res.status(502).json({error:'LTX returned an invalid task response.'});}if(!task.event_id)return res.status(502).json({error:'LTX did not provide a task ID.'});const result=await fetch(base+'/gradio_api/call/generate/'+encodeURIComponent(task.event_id),{headers,signal:AbortSignal.timeout(240000)});const events=await result.text();if(!result.ok)return res.status(502).json({error:'LTX result retrieval failed ('+result.status+').'});let videoUrl=null;for(const block of events.split(/\\n\\n/)){const event=block.match(/^event:\\s*(\\S+)/m),match=block.match(/^data:\\s*(.+)$/m);if(!event||!match)continue;if(event[1]==='error')return res.status(502).json({error:'LTX failed while rendering.'});if(event[1]==='complete'){try{const payload=JSON.parse(match[1]);const file=payload?.[0];videoUrl=file?.video?.url||file?.url||file?.path||null;}catch{}break;}}if(!videoUrl)return res.status(502).json({error:'LTX completed without returning a video file.'});if(videoUrl.startsWith('/'))videoUrl=base+'/gradio_api/file='+videoUrl;res.json({videoUrl,free:true});}catch(error){console.error('LTX render:',error.name,error.message);res.status(502).json({error:error.name==='TimeoutError'?'LTX timed out. Free queue may be unavailable.':'Could not connect to LTX video engine.'});}});

app.post('/api/narration-audio',async(req,res)=>{
 const {text}=req.body||{};
 if(typeof text!=='string'||!text.trim()||text.length>12000)return res.status(400).json({error:'Narration must contain 1–12,000 characters.'});
 const base='https://kinabraytan-kokoro-tts-server.hf.space';
 try{
  const submit=await fetch(base+'/gradio_api/call/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:[text.trim(),'af_sarah',1]}),signal:AbortSignal.timeout(45000)});
  const task=await submit.json().catch(()=>({}));
  if(!submit.ok||!task.event_id)return res.status(502).json({error:'The free Kokoro voice service is busy. Please retry.'});
  const result=await fetch(base+'/gradio_api/call/predict/'+encodeURIComponent(task.event_id),{signal:AbortSignal.timeout(240000)});
  const events=await result.text();
  if(!result.ok)return res.status(502).json({error:'The voice service could not finish the narration.'});
  let audioFile=null;
  for(const block of events.split(/\n\n/)){
   const ev=block.match(/^event:\s*(\S+)/m),data=block.match(/^data:\s*(.+)$/m);
   if(!ev||!data)continue;
   if(ev[1]==='error')return res.status(502).json({error:'Kokoro could not synthesize this narration. Try again.'});
   if(ev[1]==='complete'){try{const parsed=JSON.parse(data[1]);audioFile=Array.isArray(parsed)?parsed[0]:parsed;}catch{}break;}
  }
  let fileUrl=typeof audioFile==='string'?(audioFile.startsWith('http')?audioFile:base+'/gradio_api/file='+audioFile):(audioFile?.url||(audioFile?.path?base+'/gradio_api/file='+audioFile.path:null));
  if(!fileUrl)return res.status(502).json({error:'The voice service returned no audio file.'});
  if(fileUrl.startsWith('/'))fileUrl=base+fileUrl;
  const audio=await fetch(fileUrl,{signal:AbortSignal.timeout(45000)});
  if(!audio.ok)return res.status(502).json({error:'Could not download the generated narration audio.'});
  const wav=Buffer.from(await audio.arrayBuffer());
  const lameModule=await import('lamejs');
  const lame=lameModule.default||lameModule;
  const mp3=wavToMp3(wav,lame);
  res.setHeader('Content-Type','audio/mpeg');
  res.setHeader('Content-Disposition','attachment; filename="dreammotion-full-narration.mp3"');
  res.setHeader('Cache-Control','no-store');
  res.send(mp3);
 }catch(error){
  console.error('Kokoro narration:',error.name,error.message);
  res.status(502).json({error:error.name==='TimeoutError'?'Narration generation timed out. Try a shorter script or retry.':'The free narration service is temporarily unavailable.'});
 }
});
function wavToMp3(wav,lame){
 if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')throw new Error('TTS provider returned an unsupported audio format.');
 let offset=12,channels=1,sampleRate=24000,bits=16,dataOffset=-1,dataSize=0,format=1;
 while(offset+8<=wav.length){
  const id=wav.toString('ascii',offset,offset+4),size=wav.readUInt32LE(offset+4),start=offset+8;
  if(id==='fmt '&&size>=16){format=wav.readUInt16LE(start);channels=wav.readUInt16LE(start+2);sampleRate=wav.readUInt32LE(start+4);bits=wav.readUInt16LE(start+14);}
  if(id==='data'){dataOffset=start;dataSize=Math.min(size,wav.length-start);break;}
  offset=start+size+(size%2);
 }
 if(format!==1||bits!==16||dataOffset<0)throw new Error('TTS audio is not 16-bit PCM WAV.');
 const total=Math.floor(dataSize/(channels*2)),encoder=new lame.Mp3Encoder(channels,sampleRate,128),chunks=[];
 for(let i=0;i<total;i+=1152){
  const count=Math.min(1152,total-i),left=new Int16Array(count),right=channels>1?new Int16Array(count):null;
  for(let j=0;j<count;j++){const pos=dataOffset+(i+j)*channels*2;left[j]=wav.readInt16LE(pos);if(right)right[j]=wav.readInt16LE(pos+2);}
  const chunk=right?encoder.encodeBuffer(left,right):encoder.encodeBuffer(left);
  if(chunk.length)chunks.push(Buffer.from(chunk));
 }
 const tail=encoder.flush();if(tail.length)chunks.push(Buffer.from(tail));
 return Buffer.concat(chunks);
}

const port=process.env.PORT||3000;app.listen(port,()=>console.log('DreamMotion Studio listening on '+port));
