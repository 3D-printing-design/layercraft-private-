require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

// Set up module aliases so route files can find each other
// All files are at root level in this deployment
process.chdir(__dirname);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? [process.env.BASE_URL, 'https://layercraft.co.uk']
    : ['http://localhost:3000', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  credentials: true,
}));

app.use('/api/webhooks/gocardless', express.raw({ type: '*/*' }));
app.use('/api/webhooks/stripe', express.raw({ type: '*/*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'layercraft.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'layercraft.html')));
app.get('/payment/success', (req, res) => res.sendFile(path.join(__dirname, 'layercraft.html')));
app.get('/payment/cancelled', (req, res) => res.sendFile(path.join(__dirname, 'layercraft.html')));

app.use('/api/auth',      require('./auth'));
app.use('/api/orders',    require('./orders'));
app.use('/api/payments',  require('./payments'));
app.use('/api/webhooks',  require('./webhooks'));
app.use('/api/uploads',   require('./uploads'));
app.use('/api/printer',   require('./printer'));
app.use('/api/catalogue', require('./catalogue'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV, timestamp: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message,
  });
});

app.listen(PORT, () => {
  console.log(`\n Layercraft backend running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV}`);
  console.log(`   Base URL    : ${process.env.BASE_URL}\n`);
});

module.exports = app;
