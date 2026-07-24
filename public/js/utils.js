// Escapa texto antes de jogar em innerHTML — corrige o risco de XSS identificado na auditoria
// (o projeto original concatenava nome/emoji direto em innerHTML sem nenhum escaping).
export function escapeHtml(texto) {
    if (texto === null || texto === undefined) return '';
    return String(texto)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function primeiroNome(nomeCompleto) {
    return (nomeCompleto || '').split(' ')[0];
}

export function hojeISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function mesAtualISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Converte "HH:MM" em minutos desde a meia-noite. Retorna 0 se vazio/inválido. */
export function paraMinutos(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

/** Converte minutos em "HH:MM" (sem sinal — usado para exibir/editar carga horária). */
export function minutosParaHoras(minutos) {
    const abs = Math.max(0, minutos || 0);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const m = String(abs % 60).padStart(2, '0');
    return `${h}:${m}`;
}

/**
 * Traduz o erro que o navegador dá ao pedir a câmera (getUserMedia) para uma mensagem
 * específica, em vez de uma frase genérica igual pra qualquer motivo — cada `name` de
 * DOMException aqui indica uma causa diferente, com uma solução diferente.
 */
export function descreverErroCamera(err) {
    const nome = err && err.name;

    if (nome === 'NotAllowedError' || nome === 'PermissionDeniedError') {
        return 'Permissão da câmera negada. Verifique o cadeado ao lado do endereço do navegador e, no Windows, em Configurações > Privacidade e segurança > Câmera (precisa estar liberado tanto no geral quanto para o navegador).';
    }
    if (nome === 'NotFoundError' || nome === 'DevicesNotFoundError') {
        return 'Nenhuma câmera foi encontrada neste dispositivo.';
    }
    if (nome === 'NotReadableError' || nome === 'TrackStartError') {
        return 'A câmera já está sendo usada por outro programa ou aba (Teams, Zoom, o app Câmera do Windows, outra aba do navegador...). Feche os outros e tente de novo.';
    }
    if (nome === 'OverconstrainedError' || nome === 'ConstraintNotSatisfiedError') {
        return 'A câmera encontrada não suporta a resolução pedida.';
    }
    if (nome === 'SecurityError') {
        return 'O navegador bloqueou o acesso à câmera nesta página (contexto não seguro).';
    }
    return `Não consegui acessar a câmera${err && err.message ? ` (${err.message})` : ''}.`;
}
