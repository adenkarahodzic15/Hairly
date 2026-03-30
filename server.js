// ===== server.js corrigé =====

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || "hairly_secret",
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// ===== EMAIL =====
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS
  }
});

// ===== PRESTATIONS =====
const prestations = {
  "Coupe classique homme": 30,
  "Dégradé américain": 30,
  "Coupe enfant": 30,
  "Coupe + barbe tondeuse": 45,
  "Coupe + barbe coupe choux": 60
};

// ===== LOGIN =====
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data: salon, error } = await supabase
    .from('salons')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (error || !salon) return res.json({ success: false });

  const valid =
    (password === salon.password) ||
    await bcrypt.compare(password, salon.password);

  if (!valid) return res.json({ success: false });

  req.session.salon = {
    id: salon.id,
    slug: salon.slug,
    email: salon.email
  };

  req.session.save(() => {
    res.json({ success: true, redirect: `/dashboard/${salon.slug}` });
  });
});

// ===== DASHBOARD =====
app.get("/dashboard/:slug", (req, res) => {
  if (!req.session.salon || req.session.salon.slug !== req.params.slug) {
    return res.redirect("/login.html");
  }
  res.sendFile(path.join(__dirname, "public", "agenda.html"));
});

// ===== RECUP RDV =====
app.get("/dashboard-reservations", async (req, res) => {

  const { data } = await supabase
    .from('reservation')
    .select('*');

  res.json(data || []);
});

// ===== PRENDRE RDV =====
app.post("/reservation", async (req, res) => {

  // 🔥 IMPORTANT : on force le salon
  const salon = "homme-du-jazz";

  const { service, nom, prenom, telephone, email, date, heure, coiffeur } = req.body;
  const duree = prestations[service] || 30;

  const { data: reservationsExist } = await supabase
    .from('reservation')
    .select('*')
    .eq('salon', salon)
    .eq('date', date);

  const heureDebut = parseInt(heure.split(":")[0]) * 60 + parseInt(heure.split(":")[1]);

  const overlap = (reservationsExist || []).some(r => {
    const rDebut = parseInt(r.heure.split(":")[0]) * 60 + parseInt(r.heure.split(":")[1]);
    const rFin = rDebut + (r.duree || 30);
    return (heureDebut < rFin && (heureDebut + duree) > rDebut);
  });

  if (overlap) return res.json({ success: false, message: "Créneau déjà pris" });

  await supabase.from('reservation').insert([{
    salon,
    service,
    duree,
    nom,
    prenom,
    telephone,
    email,
    date,
    heure,
    coiffeur
  }]);

  res.json({ success: true });
});

// ===== HOME =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log("Serveur lancé"));