require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== LOG REQUESTS (DEBUG) =====
app.use((req,res,next)=>{
  console.log("REQ:", req.method, req.url);
  next();
});

// ===== SUPABASE =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ===== SESSION =====
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

// ===== DASHBOARD =====
app.get("/dashboard/:slug", (req, res) => {

  if (!req.session.salon || req.session.salon.slug !== req.params.slug) {
    return res.redirect("/login.html");
  }

  res.sendFile(path.join(__dirname, "public", "agenda.html"));
});

// ===== GET RDV =====
app.get("/dashboard-reservations", async (req, res) => {

  if (!req.session.salon) {
    return res.status(401).json([]);
  }

  const salon = req.session.salon.slug;

  const { data, error } = await supabase
    .from('reservation')
    .select('*')
    .eq('salon', salon);

  if (error) {
    console.log("GET ERROR:", error);
    return res.json([]);
  }

  res.json(data || []);
});

// ===== CREATE RDV =====
app.post("/reservation", async (req, res) => {

  try {

    const { service, nom, prenom, telephone, email, date, heure, coiffeur, salon } = req.body;

    if (!service || !nom || !date || !heure) {
      return res.json({ success: false, message: "Champs manquants" });
    }

    const salonFinal = salon || req.session?.salon?.slug;

    if (!salonFinal) {
      return res.json({ success: false, message: "Salon manquant" });
    }

    const duree = prestations[service] || 30;

    const { data: reservationsExist } = await supabase
      .from('reservation')
      .select('*')
      .eq('salon', salonFinal)
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

    const { error } = await supabase.from('reservation').insert([{
      salon: salonFinal,
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

    console.log("✅ RDV ajouté :", nom, date, heure);

    res.json({ success: true });

  } catch (err) {
    console.log("SERVER ERROR:", err);
    res.json({ success: false });
  }
});

// ===== DELETE RDV =====
app.delete("/reservation/:id", async (req, res) => {

  const { id } = req.params;

  const { error } = await supabase
    .from("reservation")
    .delete()
    .eq("id", id);

  if (error) {
    console.log("DELETE ERROR:", error);
    return res.json({ success: false });
  }

  res.json({ success: true });
});

// ===== HOME =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== START =====
app.listen(PORT, () => console.log("Serveur lancé sur le port", PORT));