import { BRAND } from './brand.js';

/**
 * Tema claro / escuro.
 *
 * O ESCURO é o padrão — é o tema que o totem usa o dia inteiro numa loja e o que
 * combina com a identidade da marca. A preferência do sistema operacional NÃO é
 * seguida automaticamente por isso: só vale o que a pessoa escolher aqui, e a
 * escolha fica guardada no navegador daquele dispositivo.
 *
 * O tema é aplicado o mais cedo possível (ver aplicarTemaSalvo, chamada antes de
 * qualquer render) para não haver aquele "flash" branco na abertura da página.
 */
const CHAVE = 'ponto_tema';
const ESCURO = 'escuro';
const CLARO = 'claro';

const COR_BARRA = { [ESCURO]: '#0b0e14', [CLARO]: '#f4f6f9' };

// A logo tem duas versões: o cinza da arte original some no fundo escuro, e a
// versão clareada some no fundo branco. Cada tema usa a que enxerga.
const LOGO_POR_TEMA = {
    [ESCURO]: '/img/logo-marine-shop-dark.png',
    [CLARO]: '/img/logo-marine-shop.png'
};

function temaSalvo() {
    try {
        const v = localStorage.getItem(CHAVE);
        return v === CLARO || v === ESCURO ? v : ESCURO;
    } catch (_) {
        return ESCURO; // navegador com storage bloqueado: segue no padrão
    }
}

export function temaAtual() {
    return document.documentElement.getAttribute('data-tema') === CLARO ? CLARO : ESCURO;
}

/** Troca a logo e avisa quem desenha em canvas (os gráficos leem cor do CSS). */
function propagarTema(tema) {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COR_BARRA[tema]);

    BRAND.logoUrl = LOGO_POR_TEMA[tema];
    document.querySelectorAll('.marca-logo-simbolo img').forEach((img) => {
        img.src = BRAND.logoUrl;
    });

    document.querySelectorAll('.troca-tema').forEach((btn) => {
        const claro = tema === CLARO;
        btn.setAttribute('aria-pressed', String(claro));
        btn.setAttribute('title', claro ? 'Mudar para o tema escuro' : 'Mudar para o tema claro');
        const rotulo = btn.querySelector('.troca-tema-rotulo');
        if (rotulo) rotulo.textContent = claro ? 'Tema claro' : 'Tema escuro';
    });

    document.dispatchEvent(new CustomEvent('tema-alterado', { detail: tema }));
}

function aplicar(tema, comAnimacao) {
    const raiz = document.documentElement;

    if (comAnimacao && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        raiz.classList.add('trocando-tema');
        // A classe só existe durante a transição: mantê-la ligada deixaria toda
        // interação da página com transição de cor, o que pesa sem necessidade.
        setTimeout(() => raiz.classList.remove('trocando-tema'), 380);
    }

    if (tema === CLARO) raiz.setAttribute('data-tema', CLARO);
    else raiz.removeAttribute('data-tema'); // escuro é o padrão do CSS

    propagarTema(tema);
}

/** Aplica o tema guardado. Deve rodar antes do primeiro render. */
export function aplicarTemaSalvo() {
    aplicar(temaSalvo(), false);
}

export function alternarTema() {
    const novo = temaAtual() === CLARO ? ESCURO : CLARO;
    try { localStorage.setItem(CHAVE, novo); } catch (_) { /* storage bloqueado */ }
    aplicar(novo, true);
    return novo;
}

/** Preenche todos os [data-troca-tema] com o switch e liga o clique. */
export function montarAlternadores() {
    document.querySelectorAll('[data-troca-tema]').forEach((slot) => {
        if (slot.dataset.pronto) return;
        slot.dataset.pronto = '1';

        const mostrarRotulo = slot.getAttribute('data-troca-tema') !== 'compacto';
        slot.classList.add('troca-tema');
        slot.setAttribute('type', 'button');
        slot.setAttribute('role', 'switch');
        slot.innerHTML = `
            <span class="switch-trilho" aria-hidden="true">
                <span class="switch-bolinha">
                    <svg class="icone-svg switch-icone-lua" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
                    <svg class="icone-svg switch-icone-sol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2M12 20.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1.5 12h2M20.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
                </span>
            </span>
            ${mostrarRotulo ? '<span class="troca-tema-rotulo"></span>' : ''}`;

        slot.addEventListener('click', alternarTema);
    });

    propagarTema(temaAtual());
}
