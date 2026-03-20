// ===== server.js amélioré avec Supabase =====

require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== INITIALISATION SUPABASE =====
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ===== MIDDLEWARE =====
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ✅ FIX SESSION (important pour Render)
app.use(session({
  secret: process.env.SESSION_SECRET || "hairly_secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false
  }
}));

// ===== EMAIL (BREVO SMTP) =====
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

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  console.log("EMAIL RECU:", email);
  console.log("PASSWORD RECU:", password);

  const { data: salon, error } = await supabase
    .from('salons') // ✅ corrigé ici
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .single();

  console.log("SALON TROUVÉ:", salon);

  if (error || !salon) {
    console.log("❌ Salon introuvable");
    return res.json({ success: false });
  }

  const valid =
    (password === salon.password) ||
    await bcrypt.compare(password, salon.password);

  console.log("PASSWORD VALIDE ?", valid);

  if (!valid) {
    console.log("❌ Mauvais mot de passe");
    return res.json({ success: false });
  }

  req.session.salon = {
    id: salon.id,
    slug: salon.slug,
    email: salon.email
  };

  req.session.save(() => {
    console.log("✅ LOGIN OK");
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

// ===== RECUPERER RDV =====
app.get("/dashboard-reservations", async (req, res) => {
  if (!req.session.salon) return res.status(401).json({ error: "Non connecté" });

  const { data: reservations, error } = await supabase
    .from('reservation')
    .select('*')
    .eq('salon', req.session.salon.slug);

  res.json(error ? [] : reservations);
});

// ===== RECUPERER CLIENTS =====
app.get("/dashboard-clients", async (req, res) => {
  if (!req.session.salon) return res.status(401).json({ error: "Non connecté" });

  const { data: clients, error } = await supabase
    .from('client')
    .select('*');

  res.json(error ? [] : clients);
});

// ===== STATISTIQUES =====
app.get("/dashboard-stats", async (req, res) => {
  if (!req.session.salon) return res.status(401).json({});

  const { count: totalClients } = await supabase
    .from('client')
    .select('*', { count: 'exact' });

  const { count: totalReservations } = await supabase
    .from('reservation')
    .select('*', { count: 'exact' })
    .eq('salon', req.session.salon.slug);

  res.json({ clients: totalClients, reservations: totalReservations });
});

// ===== PRENDRE RDV =====
app.post("/reservation", async (req, res) => {
  if (!req.session.salon) return res.status(401).json({ success: false, message: "Non connecté" });

  const { salon, service, nom, prenom, telephone, email, date, heure, coiffeur } = req.body;
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

  if (overlap) return res.json({ success: false, message: "Ce créneau est déjà réservé" });

  await supabase.from('reservation').insert([{ salon, service, duree, nom, prenom, telephone, email, date, heure, coiffeur }]);

  const { data: clientExist } = await supabase
    .from('client')
    .select('*')
    .eq('email', email)
    .single();

  if (!clientExist) {
    await supabase.from('client').insert([{
      nom, prenom, telephone, email,
      visites: 1,
      derniereVisite: date,
      historique: [{ service, date }]
    }]);
  } else {
    const updatedHistorique = [...(clientExist.historique || []), { service, date }];
    await supabase.from('client')
      .update({
        visites: clientExist.visites + 1,
        derniereVisite: date,
        historique: updatedHistorique
      })
      .eq('email', email);
  }

  // ✅ FIX EMAIL SIMPLE
  const emailSalon = process.env.HOMME_DU_JAZZ_EMAIL || "";

  if (emailSalon) {
    const mailOptions = {
      from: "Hairly <edinedo52@gmail.com>",
      to: emailSalon,
      subject: "Nouveau rendez-vous Hairly",
      text: `
Nouveau rendez-vous Hairly

Service: ${service} (${duree} min)

Nom: ${nom}
Prénom: ${prenom}
Téléphone: ${telephone}
Email: ${email}

Date: ${date}
Heure: ${heure}

Coiffeur: ${coiffeur || "Non spécifié"}
`
    };
    transporter.sendMail(mailOptions, err => { if (err) console.log("Erreur email", err); });
  }

  res.json({ success: true });
});

// ===== PAGE ACCUEIL =====
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== START SERVEUR =====
app.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));