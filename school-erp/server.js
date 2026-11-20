require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 5001);
const DATABASE_URL = process.env.DATABASE_URL || '';
if (!DATABASE_URL) throw new Error('DATABASE_URL must point to the isolated CIE Multi-Institute demo database.');
const dbName = decodeURIComponent(new URL(DATABASE_URL).pathname.slice(1));
if (!['cie_multi_institute_demo_db', 'cie_test'].includes(dbName)) {
  throw new Error('Safety stop: School ERP is allowed only on cie_multi_institute_demo_db or disposable cie_test. Production database blocked.');
}
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 8, connectionTimeoutMillis: 7000 });
const asyncRoute = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const clean = v => String(v ?? '').trim();
const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(v));
const modules = ['admissions','fees','vouchers','daybook','marksheets','whatsapp_reminders'];
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x=>x.trim()) : false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations/001_school_erp.sql'), 'utf8');
  await pool.query(sql);
}
const sign = user => jwt.sign({ sub: String(user.id), role: user.role, schoolId: user.school_id || null }, process.env.JWT_SECRET, { expiresIn: '12h', issuer: 'cie-school-erp' });
function auth(...roles) {
  return (req,res,next) => {
    try {
      const h = req.headers.authorization || '';
      if (!h.startsWith('Bearer ')) return res.status(401).json({ message: 'Login required.' });
      const p = jwt.verify(h.slice(7), process.env.JWT_SECRET, { issuer: 'cie-school-erp' });
      if (roles.length && !roles.includes(p.role)) return res.status(403).json({ message: 'Access denied.' });
      req.user = { id: Number(p.sub), role: p.role, schoolId: p.schoolId ? Number(p.schoolId) : null };
      next();
    } catch { return res.status(401).json({ message: 'Session expired. Please login again.' }); }
  };
}
async function audit(user, action, entityType, entityId, details={}) {
  await pool.query('INSERT INTO school_erp_audit_logs(school_id,actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5,$6)', [user.schoolId, user.id, action, entityType, entityId || null, JSON.stringify(details)]);
}
const requireSchool = asyncRoute(async(req,res,next) => {
  if (!req.user.schoolId) return res.status(403).json({ message: 'School account required.' });
  const r = await pool.query('SELECT id,status FROM school_erp_schools WHERE id=$1', [req.user.schoolId]);
  if (!r.rowCount || r.rows[0].status !== 'active') return res.status(403).json({ message: 'School account is inactive.' });
  next();
});
function requireModule(moduleKey) {
  return asyncRoute(async(req,res,next) => {
    const r = await pool.query('SELECT enabled FROM school_erp_modules WHERE school_id=$1 AND module_key=$2', [req.user.schoolId,moduleKey]);
    if (!r.rowCount || !r.rows[0].enabled) return res.status(403).json({ message:'This module is disabled for your school.' });
    next();
  });
}

app.get('/api/health', asyncRoute(async(_req,res) => {
  await pool.query('SELECT 1');
  res.json({ success:true, service:'CIE School ERP', database:'connected' });
}));

app.post('/api/bootstrap/super-admin', asyncRoute(async(req,res) => {
  const secret = process.env.BOOTSTRAP_SECRET;
  if (!secret || clean(req.get('x-bootstrap-secret')) !== secret) return res.status(403).json({ message:'Bootstrap not authorized.' });
  const { fullName, email, password } = req.body || {};
  if (!clean(fullName) || !emailOk(email) || String(password || '').length < 12) return res.status(400).json({ message:'Name, valid email and password (minimum 12 characters) are required.' });
  const count = await pool.query("SELECT COUNT(*)::int AS n FROM school_erp_users WHERE role='super_admin'");
  if (count.rows[0].n) return res.status(409).json({ message:'Super Admin is already initialized.' });
  const hash = await bcrypt.hash(password, 12);
  const r = await pool.query("INSERT INTO school_erp_users(full_name,email,password_hash,role) VALUES($1,LOWER($2),$3,'super_admin') RETURNING id,full_name,email,role", [clean(fullName), clean(email), hash]);
  res.status(201).json({ message:'Super Admin created. Remove BOOTSTRAP_SECRET from environment now.', user:r.rows[0] });
}));

app.post('/api/auth/login', asyncRoute(async(req,res) => {
  const { email, password, role } = req.body || {};
  const schoolCode = clean(req.body?.schoolCode).toUpperCase();
  if (!emailOk(email) || !password || !['super_admin','school_admin'].includes(role)) return res.status(400).json({ message:'Email, password and account type are required.' });
  if (role === 'school_admin' && !/^[A-Z0-9-]{3,20}$/.test(schoolCode)) return res.status(400).json({ message:'School Code is required for School Admin login.' });
  const r = role === 'super_admin'
    ? await pool.query("SELECT id,school_id,full_name,email,password_hash,role,is_active FROM school_erp_users WHERE LOWER(email)=LOWER($1) AND role='super_admin'", [clean(email)])
    : await pool.query("SELECT u.id,u.school_id,u.full_name,u.email,u.password_hash,u.role,u.is_active FROM school_erp_users u JOIN school_erp_schools s ON s.id=u.school_id WHERE LOWER(u.email)=LOWER($1) AND UPPER(s.school_code)=UPPER($2) AND u.role='school_admin'", [clean(email), schoolCode]);
  const u = r.rows[0];
  if (!u || !u.is_active || !(await bcrypt.compare(String(password), u.password_hash))) return res.status(401).json({ message:'Invalid login details or inactive account.' });
  if (u.school_id) {
    const s = await pool.query('SELECT status FROM school_erp_schools WHERE id=$1', [u.school_id]);
    if (!s.rowCount || s.rows[0].status !== 'active') return res.status(403).json({ message:'School is not active.' });
  }
  res.json({ token:sign(u), user:{ id:u.id, schoolId:u.school_id, fullName:u.full_name, email:u.email, role:u.role } });
}));

app.get('/api/me', auth('super_admin','school_admin'), asyncRoute(async(req,res) => {
  const r = await pool.query('SELECT id,school_id,full_name,email,phone,role,is_active FROM school_erp_users WHERE id=$1', [req.user.id]);
  if (!r.rowCount || !r.rows[0].is_active) return res.status(401).json({ message:'Account inactive.' });
  res.json(r.rows[0]);
}));

app.get('/api/super/schools', auth('super_admin'), asyncRoute(async(_req,res) => {
  const r = await pool.query(`SELECT s.id,s.school_code,s.name,s.email,s.phone,s.custom_domain,s.status,s.created_at,
    (SELECT COUNT(*)::int FROM school_erp_admissions a WHERE a.school_id=s.id) AS student_count,
    (SELECT COUNT(*)::int FROM school_erp_users u WHERE u.school_id=s.id AND u.role='school_admin') AS admin_count
    FROM school_erp_schools s ORDER BY s.created_at DESC`);
  res.json(r.rows);
}));
app.post('/api/super/schools', auth('super_admin'), asyncRoute(async(req,res) => {
  const b=req.body||{}, name=clean(b.name), code=clean(b.schoolCode).toUpperCase();
  if (!name || !/^[A-Z0-9-]{3,20}$/.test(code)) return res.status(400).json({message:'School name and a 3–20 character School Code are required.'});
  const c=await pool.connect();
  try {
    await c.query('BEGIN');
    const s=await c.query('INSERT INTO school_erp_schools(school_code,name,email,phone,address) VALUES($1,$2,$3,$4,$5) RETURNING *',[code,name,emailOk(b.email)?clean(b.email).toLowerCase():null,clean(b.phone)||null,clean(b.address)||null]);
    for (const m of modules) await c.query('INSERT INTO school_erp_modules(school_id,module_key,enabled) VALUES($1,$2,$3)',[s.rows[0].id,m,['admissions','fees','vouchers','daybook'].includes(m)]);
    await c.query('COMMIT');
    await audit(req.user,'school.created','school',s.rows[0].id,{schoolCode:code});
    res.status(201).json(s.rows[0]);
  } catch(e) { await c.query('ROLLBACK'); if(e.code==='23505') return res.status(409).json({message:'School Code or domain already exists.'}); throw e; }
  finally { c.release(); }
}));
app.patch('/api/super/schools/:id/status', auth('super_admin'), asyncRoute(async(req,res) => {
  const id=Number(req.params.id), status=clean(req.body.status);
  if (!Number.isSafeInteger(id)||id<1||!['active','suspended','pending'].includes(status)) return res.status(400).json({message:'Invalid school or status.'});
  const r=await pool.query('UPDATE school_erp_schools SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING id,status',[status,id]);
  if(!r.rowCount)return res.status(404).json({message:'School not found.'});
  await audit(req.user,'school.status_changed','school',id,{status});
  res.json(r.rows[0]);
}));
app.patch('/api/super/schools/:id/modules', auth('super_admin'), asyncRoute(async(req,res) => {
  const id=Number(req.params.id), key=clean(req.body.moduleKey), enabled=req.body.enabled;
  if(!Number.isSafeInteger(id)||id<1||!modules.includes(key)||typeof enabled!=='boolean')return res.status(400).json({message:'Valid school, module and enabled flag are required.'});
  const r=await pool.query('INSERT INTO school_erp_modules(school_id,module_key,enabled) VALUES($1,$2,$3) ON CONFLICT(school_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *',[id,key,enabled]);
  await audit(req.user,'school.module_changed','school',id,{moduleKey:key,enabled});
  res.json(r.rows[0]);
}));
app.patch('/api/super/schools/:id/domain', auth('super_admin'), asyncRoute(async(req,res) => {
  const id=Number(req.params.id), domain=clean(req.body.customDomain);
  if(!Number.isSafeInteger(id)||id<1||!domain||!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$/i.test(domain))return res.status(400).json({message:'A valid school domain is required.'});
  try{const r=await pool.query('UPDATE school_erp_schools SET custom_domain=$1,updated_at=NOW() WHERE id=$2 RETURNING id,custom_domain',[domain.toLowerCase(),id]);if(!r.rowCount)return res.status(404).json({message:'School not found.'});await audit(req.user,'school.domain_changed','school',id,{domain:domain.toLowerCase()});res.json(r.rows[0]);}
  catch(e){if(e.code==='23505')return res.status(409).json({message:'This domain is already assigned.'});throw e;}
}));
app.post('/api/super/schools/:id/admins', auth('super_admin'), asyncRoute(async(req,res) => {
  const schoolId=Number(req.params.id), b=req.body||{};
  if(!Number.isSafeInteger(schoolId)||schoolId<1||!clean(b.fullName)||!emailOk(b.email)||String(b.password||'').length<10) return res.status(400).json({message:'School, admin name, valid email and password (minimum 10 characters) are required.'});
  const s=await pool.query('SELECT id FROM school_erp_schools WHERE id=$1',[schoolId]);
  if(!s.rowCount)return res.status(404).json({message:'School not found.'});
  const hash=await bcrypt.hash(String(b.password),12);
  try {
    const r=await pool.query("INSERT INTO school_erp_users(school_id,full_name,email,phone,password_hash,role) VALUES($1,$2,LOWER($3),$4,$5,'school_admin') RETURNING id,school_id,full_name,email,phone,role,is_active",[schoolId,clean(b.fullName),clean(b.email),clean(b.phone)||null,hash]);
    await audit(req.user,'school_admin.created','school_user',r.rows[0].id,{schoolId});
    res.status(201).json(r.rows[0]);
  } catch(e) { if(e.code==='23505')return res.status(409).json({message:'This email is already used by an admin of this school.'}); throw e; }
}));

app.get('/api/school/summary', auth('school_admin'), requireSchool, asyncRoute(async(req,res) => {
  const id=req.user.schoolId;
  const [students,fees,expenses,income]=await Promise.all([
    pool.query('SELECT COUNT(*)::int n FROM school_erp_admissions WHERE school_id=$1',[id]),
    pool.query('SELECT COALESCE(SUM(amount),0)::numeric(14,2) n,COUNT(*)::int c FROM school_erp_fee_receipts WHERE school_id=$1',[id]),
    pool.query("SELECT COALESCE(SUM(amount),0)::numeric(14,2) n FROM school_erp_daybook WHERE school_id=$1 AND entry_type='expense'",[id]),
    pool.query("SELECT COALESCE(SUM(amount),0)::numeric(14,2) n FROM school_erp_daybook WHERE school_id=$1 AND entry_type='income'",[id])
  ]);
  res.json({students:students.rows[0].n,feeTotal:fees.rows[0].n,feeReceipts:fees.rows[0].c,expenses:expenses.rows[0].n,income:income.rows[0].n});
}));

app.get('/api/school/admissions', auth('school_admin'), requireSchool, requireModule('admissions'), asyncRoute(async(req,res) => {
  const r=await pool.query('SELECT id,admission_no,student_name,class_name,guardian_name,mobile,email,admission_date,status,created_at FROM school_erp_admissions WHERE school_id=$1 ORDER BY created_at DESC LIMIT 500',[req.user.schoolId]);
  res.json(r.rows);
}));
app.post('/api/school/admissions', auth('school_admin'), requireSchool, requireModule('admissions'), asyncRoute(async(req,res) => {
  const b=req.body||{};
  if(!clean(b.studentName)||!clean(b.className))return res.status(400).json({message:'Student name and class are required.'});
  try {
    const r=await pool.query('INSERT INTO school_erp_admissions(school_id,admission_no,student_name,class_name,guardian_name,mobile,email,admission_date) VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date,CURRENT_DATE)) RETURNING *',[req.user.schoolId,clean(b.admissionNo)||null,clean(b.studentName),clean(b.className),clean(b.guardianName)||null,clean(b.mobile)||null,emailOk(b.email)?clean(b.email).toLowerCase():null,b.admissionDate||null]);
    await audit(req.user,'admission.created','admission',r.rows[0].id);
    res.status(201).json(r.rows[0]);
  } catch(e){if(e.code==='23505')return res.status(409).json({message:'Admission number already exists in this school.'});throw e;}
}));

app.get('/api/school/fees', auth('school_admin'), requireSchool, requireModule('fees'), asyncRoute(async(req,res) => {
  const r=await pool.query('SELECT id,student_name,fee_head,amount,payment_mode,receipt_no,paid_on,created_at FROM school_erp_fee_receipts WHERE school_id=$1 ORDER BY paid_on DESC, id DESC LIMIT 500',[req.user.schoolId]);res.json(r.rows);
}));
app.post('/api/school/fees', auth('school_admin'), requireSchool, requireModule('fees'), asyncRoute(async(req,res) => {
  const b=req.body||{},amount=Number(b.amount),mode=clean(b.paymentMode).toLowerCase();
  if(!clean(b.studentName)||!clean(b.feeHead)||!Number.isFinite(amount)||amount<=0||!['cash','upi','bank','cheque','other'].includes(mode))return res.status(400).json({message:'Student, fee head, valid amount and payment mode are required.'});
  const r=await pool.query('INSERT INTO school_erp_fee_receipts(school_id,student_name,fee_head,amount,payment_mode,receipt_no,paid_on) VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE)) RETURNING *',[req.user.schoolId,clean(b.studentName),clean(b.feeHead),amount,mode,clean(b.receiptNo)||null,b.paidOn||null]);
  await audit(req.user,'fee.received','fee_receipt',r.rows[0].id,{amount});
  res.status(201).json(r.rows[0]);
}));

app.get('/api/school/vouchers', auth('school_admin'), requireSchool, requireModule('vouchers'), asyncRoute(async(req,res) => {
  const r=await pool.query('SELECT id,title,paid_to,amount,voucher_date,created_at FROM school_erp_vouchers WHERE school_id=$1 ORDER BY voucher_date DESC,id DESC LIMIT 500',[req.user.schoolId]);res.json(r.rows);
}));
app.post('/api/school/vouchers', auth('school_admin'), requireSchool, requireModule('vouchers'), asyncRoute(async(req,res) => {
  const b=req.body||{},amount=Number(b.amount);
  if(!clean(b.title)||!Number.isFinite(amount)||amount<=0)return res.status(400).json({message:'Voucher title and positive amount are required.'});
  const r=await pool.query('INSERT INTO school_erp_vouchers(school_id,title,paid_to,amount,voucher_date) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE)) RETURNING *',[req.user.schoolId,clean(b.title),clean(b.paidTo)||null,amount,b.date||null]);
  await audit(req.user,'voucher.created','voucher',r.rows[0].id,{amount});
  res.status(201).json(r.rows[0]);
}));

app.get('/api/school/daybook', auth('school_admin'), requireSchool, requireModule('daybook'), asyncRoute(async(req,res) => {
  const r=await pool.query('SELECT id,description,entry_type,amount,entry_date,created_at FROM school_erp_daybook WHERE school_id=$1 ORDER BY entry_date DESC,id DESC LIMIT 500',[req.user.schoolId]);res.json(r.rows);
}));
app.post('/api/school/daybook', auth('school_admin'), requireSchool, requireModule('daybook'), asyncRoute(async(req,res) => {
  const b=req.body||{},amount=Number(b.amount),type=clean(b.entryType).toLowerCase();
  if(!clean(b.description)||!Number.isFinite(amount)||amount<=0||!['income','expense'].includes(type))return res.status(400).json({message:'Description, entry type and positive amount are required.'});
  const r=await pool.query('INSERT INTO school_erp_daybook(school_id,description,entry_type,amount,entry_date) VALUES($1,$2,$3,$4,COALESCE($5::date,CURRENT_DATE)) RETURNING *',[req.user.schoolId,clean(b.description),type,amount,b.date||null]);
  await audit(req.user,'daybook.created','daybook',r.rows[0].id,{amount,type});
  res.status(201).json(r.rows[0]);
}));

app.get('/api/school/settings', auth('school_admin'), requireSchool, asyncRoute(async(req,res) => {
  const [s,m]=await Promise.all([pool.query('SELECT name,custom_domain,theme FROM school_erp_schools WHERE id=$1',[req.user.schoolId]),pool.query('SELECT module_key,enabled FROM school_erp_modules WHERE school_id=$1 ORDER BY module_key',[req.user.schoolId])]);
  res.json({school:s.rows[0],modules:m.rows});
}));
app.patch('/api/school/settings', auth('school_admin'), requireSchool, asyncRoute(async(req,res) => {
  const b=req.body||{},domain=clean(b.customDomain),theme=clean(b.theme||'blue');
  if(domain && !/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain))return res.status(400).json({message:'Enter a valid domain name.'});
  if(!['blue','green','maroon'].includes(theme))return res.status(400).json({message:'Invalid theme.'});
  const c=await pool.connect();
  try{await c.query('BEGIN');await c.query('UPDATE school_erp_schools SET custom_domain=$1,theme=$2,updated_at=NOW() WHERE id=$3',[domain||null,theme,req.user.schoolId]);
    if(Array.isArray(b.modules)){for(const m of b.modules){if(!modules.includes(m.moduleKey)||typeof m.enabled!=='boolean')continue;await c.query('INSERT INTO school_erp_modules(school_id,module_key,enabled) VALUES($1,$2,$3) ON CONFLICT(school_id,module_key) DO UPDATE SET enabled=EXCLUDED.enabled',[req.user.schoolId,m.moduleKey,m.enabled]);}}
    await c.query('COMMIT');await audit(req.user,'school.settings_updated','school',req.user.schoolId);res.json({success:true});
  }catch(e){await c.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({message:'This custom domain is already assigned.'});throw e;}finally{c.release();}
}));

app.get('/api/school/backup', auth('school_admin'), requireSchool, asyncRoute(async(req,res) => {
  const id=req.user.schoolId;
  const [school,admissions,fees,vouchers,daybook]=await Promise.all([
    pool.query('SELECT school_code,name,email,phone,address,custom_domain,theme FROM school_erp_schools WHERE id=$1',[id]),
    pool.query('SELECT admission_no,student_name,class_name,guardian_name,mobile,email,admission_date,status FROM school_erp_admissions WHERE school_id=$1',[id]),
    pool.query('SELECT student_name,fee_head,amount,payment_mode,receipt_no,paid_on FROM school_erp_fee_receipts WHERE school_id=$1',[id]),
    pool.query('SELECT title,paid_to,amount,voucher_date FROM school_erp_vouchers WHERE school_id=$1',[id]),
    pool.query('SELECT description,entry_type,amount,entry_date FROM school_erp_daybook WHERE school_id=$1',[id])
  ]);
  res.json({format:'cie-school-erp-backup-v1',exportedAt:new Date().toISOString(),school:school.rows[0],admissions:admissions.rows,fees:fees.rows,vouchers:vouchers.rows,daybook:daybook.rows});
}));

app.use((err,_req,res,_next)=>{console.error('School ERP API error:',err.message);res.status(500).json({message:'Server error. Check service logs.'});});
app.get('*',(req,res,next)=>{if(req.path.startsWith('/api/'))return next();res.sendFile(path.join(__dirname,'public/index.html'));});
migrate().then(()=>app.listen(PORT,()=>console.log('CIE School ERP listening on '+PORT))).catch(e=>{console.error('School ERP startup failed:',e.message);process.exit(1);});
