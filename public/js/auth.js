const CHAVE_TOTEM = 'ponto_totem_token';
const CHAVE_ADMIN = 'ponto_admin_token';
const CHAVE_ADMIN_NOME = 'ponto_admin_nome';

/* ===================== Totem (dispositivo — fica lembrado por até 90 dias) ===================== */

export function getTotemToken() {
    return localStorage.getItem(CHAVE_TOTEM);
}

export function setTotemToken(token) {
    localStorage.setItem(CHAVE_TOTEM, token);
}

export function limparTotemToken() {
    localStorage.removeItem(CHAVE_TOTEM);
}

export async function loginTotem(senha) {
    const res = await fetch('/api/auth/totem/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senha })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Não foi possível entrar.');
    setTotemToken(data.token);
    return data.token;
}

/* ===================== Admin (sessão de 12h, guardada só na aba) ===================== */

export function getAdminToken() {
    return sessionStorage.getItem(CHAVE_ADMIN);
}

export function getAdminNome() {
    return sessionStorage.getItem(CHAVE_ADMIN_NOME) || '';
}

export function limparAdminToken() {
    sessionStorage.removeItem(CHAVE_ADMIN);
    sessionStorage.removeItem(CHAVE_ADMIN_NOME);
}

export async function loginAdmin(email, senha) {
    const res = await fetch('/api/auth/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Não foi possível entrar.');
    sessionStorage.setItem(CHAVE_ADMIN, data.token);
    sessionStorage.setItem(CHAVE_ADMIN_NOME, data.nome || '');
    return data;
}
