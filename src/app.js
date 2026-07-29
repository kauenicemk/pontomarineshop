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

const { comContexto } = require('./utils/contextoRequisicao');

const app = new Hono();

/**
 * Content-Security-Policy ativa: se algum dado escapar do escapeHtml e virar HTML,
 * o navegador ainda recusa executar script injetado.
 *
 * - scriptSrc 'self': todo JS vem do próprio domínio (o face-api é local, nunca CDN).
 *   Não há 'unsafe-inline' aqui de propósito — é o que dá valor à regra.
 * - styleSrc aceita inline porque os módulos usam style="..." nos elementos que geram;
 *   injeção de CSS tem risco muito menor que injeção de script.
 * - mediaSrc/imgSrc com blob: e data: por causa da câmera do reconhecimento facial.
 */
app.use(secureHeaders({
    contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
    }
}));

// Teto de tamanho do corpo. Um POST gigante consumiria CPU do Worker à toa; o maior
// corpo legítimo é o descritor facial (128 números, ~3 KB), então 256 KB sobra.
const TAMANHO_MAXIMO_CORPO = 256 * 1024;

app.use('/api/*', async (c, next) => {
    const tamanho = Number(c.req.header('content-length') || 0);
    if (tamanho > TAMANHO_MAXIMO_CORPO) {
        return c.json({ message: 'Requisição grande demais.' }, 413);
    }
    await next();

    // Respostas de API carregam dados pessoais (nomes, pontos, salários): nunca podem
    // ficar em cache de navegador, proxy ou CDN.
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    c.header('Pragma', 'no-cache');
});

// Abre um contexto por requisição. O objeto é preenchido pelo adminAuth quando a
// rota exige login — é ele que leva "quem fez" até o log de auditoria.
app.use('*', async (c, next) => {
    const dados = {
        admin: null,
        ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
        rota: `${c.req.method} ${new URL(c.req.url).pathname}`
    };
    return comContexto(dados, () => next());
});

// Login (totem e admin) são os alvos de força bruta, agora que o sistema é público.
// (/api/ajuste-ponto saiu daqui: já exige token de admin, e o limite de 15/15min
//  impedia o RH de corrigir vários pontos em sequência.)
app.use('/api/auth/totem/login', limiteAutenticacao);
app.use('/api/auth/admin/login', limiteAutenticacao);
app.use('/api/funcionarios/*/verificar-pin', limiteAutenticacao);
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
