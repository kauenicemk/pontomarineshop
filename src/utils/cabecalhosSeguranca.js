/**
 * Cabeçalhos de segurança aplicados às PÁGINAS (HTML, JS, CSS) servidas pelo
 * Cloudflare Pages. As rotas /api/* recebem os seus pelo secureHeaders do Hono
 * (ver src/app.js) — mas o HTML nunca passa pelo Hono, então sem isto aqui a
 * Content-Security-Policy simplesmente não valeria para a interface, que é
 * justamente onde ela protege.
 *
 * scriptSrc sem 'unsafe-inline' é o ponto central: mesmo que algum dado escape do
 * escapeHtml e vire HTML, o navegador recusa executar script injetado. Por isso o
 * código não usa atributos onload=/onclick= no HTML — tudo é addEventListener.
 */
const CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
].join('; ');

const CABECALHOS = {
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()'
};

/** Devolve uma cópia da resposta com os cabeçalhos de segurança aplicados. */
export function comCabecalhosSeguranca(resposta) {
    const nova = new Response(resposta.body, resposta);
    Object.entries(CABECALHOS).forEach(([chave, valor]) => nova.headers.set(chave, valor));
    return nova;
}
