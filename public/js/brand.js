/**
 * Identidade do sistema — ÚNICO lugar para trocar nome e logo.
 *
 * Arquivos em public/img/:
 *   logo-marine-shop.png          → logo oficial (cinza + laranja), para fundos claros
 *   logo-marine-shop-dark.png     → mesma logo com o cinza clareado, usada na interface
 *                                   escura (o cinza original desaparece sobre fundo escuro)
 *   logo-marine-shop-original.png → cópia intacta do arquivo enviado, só para referência
 *
 * Para trocar a logo, substitua o arquivo apontado por `logoUrl` — o componente exibe
 * a imagem inteira (object-fit: contain), sem corte nem distorção, qualquer proporção.
 */
export const BRAND = {
    nome: 'Ponto Marine Shop',
    empresa: 'Marine Shop',
    logoUrl: '/img/logo-marine-shop-dark.png',
    monograma: 'MS'
};

/**
 * Preenche todos os elementos com [data-logo] com a marca (logo + nome).
 * Variações:
 *   data-logo            → logo + nome, lado a lado (cabeçalhos)
 *   data-logo="grande"   → versão empilhada e maior (telas de login)
 *   data-logo="so-logo"  → só a imagem, sem texto
 */
export function montarLogos() {
    document.querySelectorAll('[data-logo]').forEach((slot) => {
        const variacao = slot.getAttribute('data-logo');
        slot.classList.add('marca-logo');
        if (variacao === 'grande') slot.classList.add('marca-logo-grande');

        const nomeHtml = variacao === 'so-logo'
            ? ''
            : `<span class="marca-logo-nome">${BRAND.nome}</span>`;

        slot.innerHTML = `
            <span class="marca-logo-simbolo">
                <img src="${BRAND.logoUrl}" alt="Logo ${BRAND.empresa}">
                <span class="marca-monograma" aria-hidden="true">${BRAND.monograma}</span>
            </span>
            ${nomeHtml}`;

        // Listeners em JS, sem onload=/onerror= no HTML: atributos inline seriam
        // bloqueados pela Content-Security-Policy (script-src 'self', sem unsafe-inline).
        // O monograma é o estado de erro: fica display:none até a imagem falhar.
        // Só o caminho de falha precisa de classe — o sucesso já é o padrão do CSS.
        const simbolo = slot.querySelector('.marca-logo-simbolo');
        const img = simbolo.querySelector('img');
        img.addEventListener('error', () => simbolo.classList.add('sem-imagem'));
        if (img.complete && img.naturalWidth === 0) simbolo.classList.add('sem-imagem');
    });

    document.title = BRAND.nome;
}
