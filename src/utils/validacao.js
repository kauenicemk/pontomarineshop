const { TIPOS_VALIDOS } = require('./tempo');

class ErroValidacao extends Error {
    constructor(mensagem) {
        super(mensagem);
        this.name = 'ErroValidacao';
        this.status = 400;
    }
}

function exigirInteiro(valor, nomeCampo) {
    const n = Number(valor);
    if (!Number.isInteger(n)) throw new ErroValidacao(`Campo "${nomeCampo}" deve ser um número inteiro.`);
    return n;
}

function exigirTexto(valor, nomeCampo, { minLen = 1, maxLen = 255 } = {}) {
    if (typeof valor !== 'string' || valor.trim().length < minLen || valor.length > maxLen) {
        throw new ErroValidacao(`Campo "${nomeCampo}" é obrigatório (${minLen}-${maxLen} caracteres).`);
    }
    return valor.trim();
}

function exigirTipoPonto(valor) {
    if (!TIPOS_VALIDOS.includes(valor)) {
        throw new ErroValidacao(`Tipo de ponto inválido. Use um de: ${TIPOS_VALIDOS.join(', ')}.`);
    }
    return valor;
}

function exigirHora(valor, nomeCampo) {
    if (typeof valor !== 'string' || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(valor)) {
        throw new ErroValidacao(`Campo "${nomeCampo}" deve estar no formato HH:MM.`);
    }
    return valor;
}

function exigirData(valor, nomeCampo) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
        throw new ErroValidacao(`Campo "${nomeCampo}" deve estar no formato YYYY-MM-DD.`);
    }
    return valor;
}

function exigirPin(valor, nomeCampo = 'pin') {
    if (typeof valor !== 'string' || !/^\d{4,8}$/.test(valor)) {
        throw new ErroValidacao(`Campo "${nomeCampo}" deve ter entre 4 e 8 dígitos numéricos.`);
    }
    return valor;
}

const TURNOS_VALIDOS = ['manha_tarde', 'tarde_noite'];

function exigirTurno(valor) {
    if (!TURNOS_VALIDOS.includes(valor)) {
        throw new ErroValidacao('Turno inválido. Use manha_tarde ou tarde_noite.');
    }
    return valor;
}

function exigirRegime(valor) {
    if (!['CLT', 'ESTAGIARIO', 'PJ'].includes(valor)) {
        throw new ErroValidacao(`Regime inválido. Use CLT, ESTAGIARIO ou PJ.`);
    }
    return valor;
}

function exigirDataOpcional(valor, nomeCampo) {
    if (valor === null || valor === undefined || valor === '') return null;
    return exigirData(valor, nomeCampo);
}

function exigirValorMonetarioOpcional(valor, nomeCampo) {
    if (valor === null || valor === undefined || valor === '') return null;
    const n = Number(valor);
    if (!Number.isFinite(n) || n < 0) {
        throw new ErroValidacao(`Campo "${nomeCampo}" deve ser um valor monetário válido (maior ou igual a zero).`);
    }
    return n;
}

function exigirTextoOpcional(valor, nomeCampo, { maxLen = 255 } = {}) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor !== 'string' || valor.length > maxLen) {
        throw new ErroValidacao(`Campo "${nomeCampo}" inválido (máximo ${maxLen} caracteres).`);
    }
    return valor.trim();
}

function exigirMesReferencia(valor, nomeCampo) {
    if (typeof valor !== 'string' || !/^\d{4}-\d{2}$/.test(valor)) {
        throw new ErroValidacao(`Campo "${nomeCampo}" deve estar no formato YYYY-MM.`);
    }
    return valor;
}

const TAMANHO_DESCRITOR_FACIAL = 128;

function exigirDescritorFacial(valor) {
    if (!Array.isArray(valor) || valor.length !== TAMANHO_DESCRITOR_FACIAL || !valor.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new ErroValidacao(`Descritor facial inválido (esperado um vetor de ${TAMANHO_DESCRITOR_FACIAL} números).`);
    }
    return valor;
}

module.exports = {
    ErroValidacao,
    exigirInteiro,
    exigirTexto,
    exigirTextoOpcional,
    exigirTipoPonto,
    exigirHora,
    exigirData,
    exigirDataOpcional,
    exigirMesReferencia,
    exigirValorMonetarioOpcional,
    exigirPin,
    exigirRegime,
    exigirTurno,
    exigirDescritorFacial,
    TURNOS_VALIDOS
};
