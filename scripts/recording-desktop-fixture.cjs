process.on('message',async({url})=>{
  try {const result=await fetch(url,{headers:{Authorization:'Bearer SYNTHETIC_HEADER'}});await result.text();process.send({status:result.status});}
  catch {process.send({failed:true});}
});
process.send({ready:true});
