const { Hono } = require('hono');
const { secureHeaders } = require('hono/secure-headers');

const { limiteAutenticacao, limiteGeral } = require('./middleware/rateLimiters');
const { errorHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const funcionariosRoutes = require('./routes/funcionarios.routes');
const pontoRoutes = require('./routes/ponto.routes');
const relatoriosRoutes = require('./routes/relatorios.routes');
const feriadosRoutes = require('./routes/feriados.routes');
const ausenciasRoutes = require('./routes/ausencias.routes');
const adminRoutes = require('./routes/admin.routes');
const feriasRoutes = require('./routes/ferias.routes');
const espelhoRoutes = require('./routes/espelho.routes');
const analyticsRoutes = require('./routes/analytics.routes');

const app = new Hono();

app.use(secureHeaders({ contentSecurityPolicy: false }));

// Login (totem e admin) são os alvos de força bruta, agora que o sistema é público.
// (/api/ajuste-ponto saiu daqui: já exige token de admin, e o limite de 15/15min
//  impedia o RH de corrigir vários pontos em sequência.)
app.use('/api/auth/totem/login', limiteAutenticacao);
app.use('/api/auth/admin/login', limiteAutenticacao);
app.use('/api/*', limiteGeral);

// Servir arquivos estáticos (public/) e o roteamento de "/" ficam a cargo do Cloudflare
// Pages (binding ASSETS em public/_worker.js) — o banco e o código-fonte do backend nunca
// ficam acessíveis via HTTP.

app.route('/api/auth', authRoutes);
app.route('/api/funcionarios', funcionariosRoutes);
app.route('/api', pontoRoutes);
app.route('/api', relatoriosRoutes);
app.route('/api/feriados', feriadosRoutes);
app.route('/api/ausencias', ausenciasRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/ferias', feriasRoutes);
app.route('/api/espelho', espelhoRoutes);
app.route('/api/analytics', analyticsRoutes);

app.notFound((c) => c.json({ message: 'Rota não encontrada.' }, 404));
app.onError(errorHandler);

module.exports = app;
