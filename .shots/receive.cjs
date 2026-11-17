const http=require('http'),fs=require('fs');
http.createServer((q,r)=>{r.setHeader('Access-Control-Allow-Origin','*');r.setHeader('Access-Control-Allow-Headers','*');if(q.method==='OPTIONS'){r.end();return}
let b='';q.on('data',d=>b+=d);q.on('end',()=>{const n=(q.url.split('?n=')[1]||'shot')+'.png';fs.writeFileSync(__dirname+'/'+n,Buffer.from(b.split(',')[1],'base64'));r.end('ok '+n)})}).listen(5199);
