// ===== server.js corrigé FINAL =====

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== SUPABASE =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ✅ SESSION CONFIG FIX
app.use(session({
  secret: process.env.SESSION_SECRET || "hairly_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: "lax"
  }
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

  const { data: salon } = await supabase
    .from('salons')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .single();

  if (!salon) return res.json({ success: false });

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
    res.json({
      success: true,
      redirect: `/dashboard/${salon.slug}`
    });
  });
});

// ===== LOGOUT =====
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ===== DASHBOARD =====
app.get("/dashboard/:slug", (req, res) => {

  if (!req.session.salon || req.session.salon.slug !== req.params.slug) {
    return res.redirect("/login.html");
  }

  res.sendFile(path.join(__dirname, "public", "agenda.html"));
});

// ===== RECUPERER RDV =====
app.get("/dashboard-reservations", async (req, res) => {

  if (!req.session.salon) {
    return res.status(401).json({ error: "Non connecté" });
  }

  const { data, error } = await supabase
    .from('reservation')
    .select('*')
    .eq('salon', req.session.salon.slug);

  if (error) {
    console.log(error);
    return res.json([]);
  }

  res.json(data);
});

// ===== RESERVATION =====
app.post("/reservation", async (req, res) => {

  const { service, nom, prenom, telephone, email, date, heure, coiffeur } = req.body;

  if (!service || !nom || !date || !heure) {
    return res.json({ success: false, message: "Champs manquants" });
  }

  // 🔥 salon fixé (tu peux le rendre dynamique plus tard)
  const salon = "homme-du-jazz";

  const duree = prestations[service] || 30;

  // Vérification conflits
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

  if (overlap) {
    return res.json({ success: false, message: "Créneau déjà pris" });
  }

  // INSERT SUPABASE
  const { error } = await supabase.from('reservation').insert([{
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

  if (error) {
    console.log("INSERT ERROR:", error);
    return res.json({ success: false });
  }

  // EMAIL (optionnel)
  const emailSalon = process.env.HOMME_DU_JAZZ_EMAIL;

  if (emailSalon) {
    transporter.sendMail({
      from: "Hairly <edinedo52@gmail.com>",
      to: emailSalon,
      subject: "Nouveau rendez-vous",
      text: `Rendez-vous:\n${nom} ${prenom}\n${date} ${heure}`
    });
  }

  res.json({ success: true });
});

// ===== HOME =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== START =====
app.listen(PORT, () => console.log("Serveur lancé sur le port", PORT));