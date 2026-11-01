require('dotenv').config();
const express=require('express');
const cors=require('cors');
const helmet=require('helmet');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const {pool}=require('./db');
const app=express();
const port=Number(process.env.PORT||5000);
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({origin:process.env.CORS_ORIGIN?process.env.CORS_ORIGIN.split(',').map(x=>x.trim()):true,credentials:true}));
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:false,limit:'1mb'}));
app.use(express.static(require('path').join(__dirname,'../public')));
const asyncRoute=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const clean=s=>String(s||'').trim();
const tokenFor=user=>jwt.sign({sub:String(user.id),role:user.role,instituteId:user.institute_id||null},process.env.JWT_SECRET,{expiresIn:'12h'});
function auth(...roles){return (req,res,next)=>{try{const h=req.headers.authorization||'';const t=h.startsWith('Bearer ')?h.slice(7):'';if(!t) return res.status(401).json({message:'Login required'});const p=jwt.verify(t,process.env.JWT_SECRET);if(roles.length&&!roles.includes(p.role)) return res.status(403).json({message:'Access denied'});req.user=p;next();}catch{return res.status(401).json({message:'Session expired. Please login again.'});}}}
app.get('/api/health',asyncRoute(async(_req,res)=>{await pool.query('SELECT 1');res.json({success:true,service:'CIE Multi-Institute API',database:'connected'});}));
app.post('/api/setup/super-admin',asyncRoute(async(req,res)=>{
 if(!process.env.BOOTSTRAP_SECRET||clean(req.headers['x-bootstrap-secret'])!==process.env.BOOTSTRAP_SECRET) return res.status(403).json({message:'Setup is not authorized'});
 const {fullName,email,password}=req.body||{};
 if(!clean(fullName)||!/^\S+@\S+\.\S+$/.test(clean(email))||String(password||'').length<12) return res.status(400).json({message:'Enter name, valid email and password (minimum 12 characters).'});
 const count=await pool.query('SELECT COUNT(*)::int AS n FROM super_admins');
 if(count.rows[0].n>0) return res.status(409).json({message:'Super Admin already initialized'});
 const hash=await bcrypt.hash(password,12);
 const r=await pool.query('INSERT INTO super_admins(full_name,email,password_hash) VALUES($1,LOWER($2),$3) RETURNING id,full_name,email,is_active',[clean(fullName),clean(email),hash]);
 res.status(201).json({message:'Super Admin created. Remove BOOTSTRAP_SECRET from deployment settings.',admin:r.rows[0]});
}));
app.post('/api/auth/login',asyncRoute(async(req,res)=>{
 const {email,password,role}=req.body||{};const e=clean(email).toLowerCase();
 if(!e||!password||!['super_admin','institute_admin'].includes(role)) return res.status(400).json({message:'Email, password and account type are required'});
 let r;
 if(role==='super_admin') r=await pool.query('SELECT id,full_name,email,password_hash,is_active FROM super_admins WHERE LOWER(email)=LOWER($1)',[e]);
 else r=await pool.query("SELECT id,full_name,email,password_hash,is_active,institute_id,role FROM institute_admins WHERE LOWER(email)=LOWER($1)",[e]);
 const u=r.rows[0];if(!u||!u.is_active||!(await bcrypt.compare(password,u.password_hash))) return res.status(401).json({message:'Invalid login details or inactive account'});
 if(role==='institute_admin'){const i=await pool.query("SELECT status FROM institutes WHERE id=$1",[u.institute_id]);if(!i.rows[0]||i.rows[0].status!=='approved')return res.status(403).json({message:'Institute is not approved'});}
 const payload={id:u.id,full_name:u.full_name,email:u.email,role,institute_id:u.institute_id||null};
 res.json({token:tokenFor(payload),user:payload});
}));
app.post('/api/institute-applications',asyncRoute(async(req,res)=>{
 const b=req.body||{};const name=clean(b.instituteName),applicant=clean(b.applicantName),email=clean(b.email).toLowerCase(),phone=clean(b.phone),password=String(b.password||'');
 if(!name||!applicant||!/^\S+@\S+\.\S+$/.test(email)||!phone||password.length<8) return res.status(400).json({message:'Please complete all required fields. Password must be at least 8 characters.'});
 const exists=await pool.query('SELECT 1 FROM institute_admin_applications WHERE LOWER(email)=LOWER($1) AND status='pending'',[email]);
 if(exists.rowCount) return res.status(409).json({message:'A pending application already exists for this email.'});
 const hash=await bcrypt.hash(password,12);
 await pool.query('INSERT INTO institute_admin_applications(institute_name,applicant_name,email,phone,password_hash,address,state,district,message) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[name,applicant,email,phone,hash,clean(b.address),clean(b.state),clean(b.district),clean(b.message)]);
 res.status(201).json({message:'Application submitted. CIE will review it before account activation.'});
}));
app.get('/api/super-admin/overview',auth('super_admin'),asyncRoute(async(_req,res)=>{
 const [institutes,apps,admins,students,exams]=await Promise.all([
 pool.query("SELECT COUNT(*)::int total,COUNT(*) FILTER(WHERE status='approved')::int approved,COUNT(*) FILTER(WHERE status='pending')::int pending FROM institutes"),
 pool.query("SELECT COUNT(*)::int total FROM institute_admin_applications WHERE status='pending'"),
 pool.query("SELECT COUNT(*)::int total FROM institute_admins WHERE is_active=true"),
 pool.query("SELECT COUNT(*)::int total FROM students WHERE status='active'"),
 pool.query("SELECT COUNT(*)::int total FROM exams")]);
 res.json({institutes:institutes.rows[0],pendingApplications:apps.rows[0].total,activeAdmins:admins.rows[0].total,students:students.rows[0].total,exams:exams.rows[0].total});
}));
app.get('/api/super-admin/applications',auth('super_admin'),asyncRoute(async(_req,res)=>{const r=await pool.query("SELECT id,institute_name,applicant_name,email,phone,state,district,created_at FROM institute_admin_applications WHERE status='pending' ORDER BY created_at ASC");res.json(r.rows);}));
app.post('/api/super-admin/applications/:id/decision',auth('super_admin'),asyncRoute(async(req,res)=>{
 const id=Number(req.params.id),decision=clean(req.body.decision),note=clean(req.body.note);
 if(!Number.isInteger(id)||id<1||!['approve','reject'].includes(decision))return res.status(400).json({message:'Invalid application decision'});
 const client=await pool.connect();
 try{await client.query('BEGIN');const a=await client.query("SELECT * FROM institute_admin_applications WHERE id=$1 AND status='pending' FOR UPDATE",[id]);if(!a.rowCount){await client.query('ROLLBACK');return res.status(404).json({message:'Pending application not found'});}
 const x=a.rows[0];await client.query("UPDATE institute_admin_applications SET status=$1,reviewed_by=$2,reviewed_at=NOW(),review_note=$3 WHERE id=$4",[decision==='approve'?'approved':'rejected',req.user.sub,note,id]);
 if(decision==='approve'){
 const code='CIE'+String(Date.now()).slice(-8);
 const ins=await client.query("INSERT INTO institutes(institute_code,institute_name,email,phone,address,state,district,status,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$8,NOW()) RETURNING id",[code,x.institute_name,x.email,x.phone,x.address,x.state,x.district,req.user.sub]);
 await client.query("INSERT INTO institute_admins(institute_id,full_name,email,phone,password_hash) VALUES($1,$2,$3,$4,$5)",[ins.rows[0].id,x.applicant_name,x.email,x.phone,x.password_hash]);
 }
 await client.query('COMMIT');res.json({message:decision==='approve'?'Institute approved and admin account created':'Application rejected'});
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.get('/api/institutes',auth('super_admin'),asyncRoute(async(_req,res)=>{const r=await pool.query("SELECT i.id,i.institute_code,i.institute_name,i.email,i.phone,i.state,i.district,i.status,i.created_at,(SELECT COUNT(*) FROM students s WHERE s.institute_id=i.id)::int student_count FROM institutes i ORDER BY i.created_at DESC");res.json(r.rows);}));
app.use('/api',(req,res)=>res.status(404).json({message:'API route not found'}));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({message:'Server error. Please try again.'});});
app.listen(port,()=>console.log('CIE Multi-Institute listening on '+port));
