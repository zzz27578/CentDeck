export const ATTACHMENT_ACCEPT='.png,.jpg,.jpeg,.webp,.mp3,.wav,.txt,.md,.html,.htm,.css,.js,.json,.csv';
export const MAX_ATTACHMENTS=4;
const mediaTypes={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp3:'audio/mpeg',wav:'audio/wav'};
export async function readAttachment(file) {
  const ext=file.name.split('.').pop().toLowerCase();
  const mime=file.type||mediaTypes[ext]||'';
  const media=/^image\/(png|jpeg|webp)$/.test(mime)?'image':/^audio\/(mpeg|mp3|wav|x-wav)$/.test(mime)?'audio':null;
  if(media){
    if(file.size>4*1024*1024)throw Error('图片或音频请控制在 4 MB 以内');
    const bytes=new Uint8Array(await file.arrayBuffer());let raw='';
    for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {kind:'file',name:file.name,size:file.size,media,url:`data:${mime};base64,${btoa(raw)}`};
  }
  if(/^(txt|md|html?|css|js|json|csv)$/.test(ext)){
    if(file.size>128000)throw Error('文本附件请控制在 128 KB 以内');
    return {kind:'file',name:file.name,size:file.size,text:await file.text()};
  }
  throw Error('支持 PNG、JPG、WebP、MP3、WAV，以及 TXT、Markdown、HTML、CSS、JS、JSON、CSV 文本');
}
