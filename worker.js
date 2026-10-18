// Cloudflare Worker + D1. Deploy separately from GitHub Pages.
const enc=new TextEncoder();
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const hex=bytes=>Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
const digest=async s=>hex(await crypto.subtle.digest('SHA-256',enc.encode(s)));
async function passwordHash(password,salt){const base=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:310000,hash:'SHA-256'},base,256))}
function equal(a,b){if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a.charCodeAt(i)^b.charCodeAt(i);return v===0}
const error=(msg,status=400)=>json({error:msg},status);
const now=()=>Math.floor(Date.now()/1000);
async function userFromRequest(req,db){const match=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization')||'');if(!match)return null;const hash=await digest(match[1]);return db.prepare('SELECT u.id,u.username,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash,now()).first()}
async function session(db,user){const token=random(),hash=await digest(token);await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(hash,user.id,now()+60*60*24*30).run();return {token,user:{id:user.id,username:user.username}}}
async function bodyJSON(req){const content=req.headers.get('Content-Length');if(content&&Number(content)>900000)throw Error('حجم الطلب كبير');const raw=await req.text();if(raw.length>900000)throw Error('حجم الطلب كبير');return JSON.parse(raw)}
export default {async fetch(req,env){const origin=req.headers.get('Origin')||'';const allowed=(env.ALLOWED_ORIGIN||'').replace(/\/$/,'');const cors=origin===allowed?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, PUT, OPTIONS'}:{};
if(req.method==='OPTIONS')return new Response(null,{status:origin===allowed?204:403,headers:cors});
if(origin&&origin!==allowed)return error('المصدر غير مسموح',403);
const reply=(data,status=200)=>json(data,status,cors);
try{const url=new URL(req.url),path=url.pathname,db=env.DB;if(!db)return reply({error:'قاعدة البيانات غير مهيأة'},503);
if(path==='/api/health'&&req.method==='GET')return reply({ok:true});
if((path==='/api/auth/register'||path==='/api/auth/login')&&req.method==='POST'){
const {username,password}=await bodyJSON(req);if(typeof username!=='string'||!/^[a-z0-9_]{3,24}$/.test(username)||typeof password!=='string'||password.length<12||password.length>256)return reply({error:'اسم مستخدم غير صالح أو كلمة مرور أقل من 12 حرفًا'},400);
const ip=req.headers.get('CF-Connecting-IP')||'unknown',key=await digest(ip+':'+username);const rate=await db.prepare('SELECT count,reset_at FROM attempts WHERE key=?').bind(key).first();if(rate&&rate.count>=12&&rate.reset_at>now())return reply({error:'محاولات كثيرة، انتظر 15 دقيقة'},429);
await db.prepare('INSERT INTO attempts(key,count,reset_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<? THEN 1 ELSE count+1 END, reset_at=CASE WHEN reset_at<? THEN ? ELSE reset_at END').bind(key,1,now()+900,now(),now(),now()+900).run();
if(path.endsWith('register')){const existing=await db.prepare('SELECT id FROM users WHERE username=?').bind(username).first();if(existing)return reply({error:'اسم المستخدم مستخدم بالفعل'},409);const id=crypto.randomUUID(),salt=random(),hash=await passwordHash(password,salt);try{await db.prepare('INSERT INTO users(id,username,salt,password_hash,created_at) VALUES(?,?,?,?,?)').bind(id,username,salt,hash,now()).run()}catch{return reply({error:'اسم المستخدم مستخدم بالفعل'},409)}const sess=await session(db,{id,username});return reply(sess,201)}
const user=await db.prepare('SELECT id,username,salt,password_hash FROM users WHERE username=?').bind(username).first();const salt=user?.salt||'00000000000000000000000000000000',expected=user?.password_hash||'0'.repeat(64),actual=await passwordHash(password,salt);if(!user||!equal(actual,expected))return reply({error:'اسم المستخدم أو كلمة المرور غير صحيح'},401);await db.prepare('DELETE FROM attempts WHERE key=?').bind(key).run();return reply(await session(db,user))}
const u=await userFromRequest(req,db);if(!u)return reply({error:'جلسة غير صالحة؛ سجّل الدخول مرة أخرى'},401);
if(path==='/api/me'&&req.method==='GET')return reply({user:{id:u.id,username:u.username}});
if(path==='/api/auth/logout'&&req.method==='POST'){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(u.token_hash).run();return reply({ok:true})}
if(path==='/api/data'&&req.method==='GET'){const row=await db.prepare('SELECT payload,revision FROM user_data WHERE user_id=?').bind(u.id).first();return reply({payload:row?JSON.parse(row.payload):null,revision:row?.revision||0})}
if(path==='/api/data'&&req.method==='PUT'){const data=await bodyJSON(req),p=data.payload;if(!p||typeof p!=='object'||!p.db||typeof p.db!=='object'||!p.db.days||!Array.isArray(p.db.rewards)||!Array.isArray(p.db.purchases)||!p.v4||!p.v5||!Number.isInteger(data.revision)||data.revision<0)return reply({error:'بيانات غير صالحة'},400);const serialized=JSON.stringify(p);if(serialized.length>700000)return reply({error:'تجاوزت البيانات الحد المسموح'},413);const result=await db.prepare('INSERT INTO user_data(user_id,payload,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,revision=user_data.revision+1,updated_at=excluded.updated_at WHERE user_data.revision=?').bind(u.id,serialized,now(),data.revision).run();if(!result.meta.changes)return reply({error:'تعارض في النسخ: تم التعديل من جهاز آخر؛ لا يمكن استبدال بياناته تلقائيًا'},409);const row=await db.prepare('SELECT revision FROM user_data WHERE user_id=?').bind(u.id).first();return reply({revision:row.revision})}
return reply({error:'المسار غير موجود'},404)
}catch(e){return reply({error:e instanceof SyntaxError?'صيغة JSON غير صالحة':'تعذر إكمال الطلب'},400)}}};
