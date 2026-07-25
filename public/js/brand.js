/**
 * Identidade do sistema — ÚNICO lugar para trocar nome e logo.
 *
 * Para usar a logo oficial da Marine Shop, basta salvar o arquivo em
 * public/img/logo-marine-shop.png (qualquer proporção funciona — a imagem é
 * encaixada com object-fit: contain). Enquanto o arquivo não existir, o
 * sistema mostra automaticamente um monograma "MS" como placeholder.
 */
export const BRAND = {
    nome: 'Ponto Marine Shop',
    empresa: 'Marine Shop',
    logoUrl: 'img/logo-marine-shop.png',
    monograma: 'MS'
};

/**
 * Preenche todos os elementos com [data-logo] com a marca (logo + nome).
 * Variações:
 *   data-logo            → logo + nome completo
 *   data-logo="grande"   → versão maior (telas de login)
 *   data-logo="so-logo"  → só o símbolo, sem texto
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
                <img src="${BRAND.logoUrl}" alt="Logo ${BRAND.empresa}"
                     onload="this.closest('.marca-logo-simbolo').classList.add('com-imagem')"
                     onerror="this.closest('.marca-logo-simbolo').classList.add('sem-imagem')">
                <span class="marca-monograma" aria-hidden="true">${BRAND.monograma}</span>
            </span>
            ${nomeHtml}`;
    });

    document.title = BRAND.nome;
}
