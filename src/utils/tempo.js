// Mapeamento único do tipo de registro (usado em relatorio, pendências e histórico —
// antes estava duplicado em 3 lugares diferentes).
const TIPO_PARA_CHAVE = {
    'Entrada': 'ENTRADA',
    'Saída Almoço': 'ALMOCO_SAIDA',
    'Retorno Almoço': 'ALMOCO_RETORNO',
    'Saída Final': 'SAIDA'
};

const TIPOS_VALIDOS = Object.keys(TIPO_PARA_CHAVE);

/**
 * Os 6 dias configuráveis individualmente por funcionário (domingo fica de fora de propósito —
 * nunca é dia de trabalho configurável, sempre é considerado descanso; trabalho nesse dia sempre
 * vira hora extra de domingo/feriado, nunca falta).
 */
const DIAS_SEMANA = ['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

// Janela do adicional noturno (CLT, trabalhador urbano): 22h de um dia até 5h do dia seguinte.
const INICIO_NOTURNO_MIN = 22 * 60; // 1320
const FIM_NOTURNO_MIN = 5 * 60;     // 300

/** Converte "HH:MM" em minutos desde a meia-noite. Retorna 0 se vazio/invalido. */
function paraMinutos(hhmm) {
    if (!hhmm) return 0;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
}

/** Converte minutos em "HH:MM", com sinal opcional (+/-). */
function minutosParaStr(minutos, comSinal = false) {
    const sinal = minutos < 0 ? '-' : (comSinal ? '+' : '');
    const abs = Math.abs(minutos);
    const h = String(Math.floor(abs / 60)).padStart(2, '0');
    const m = String(abs % 60).padStart(2, '0');
    return `${sinal}${h}:${m}`;
}

/** Retorna {data: 'YYYY-MM-DD', hora: 'HH:MM:SS', iso: 'YYYY-MM-DDTHH:MM:SS'} para o horário atual de Brasília. */
function agoraBrasilia() {
    const partes = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
    }).formatToParts(new Date()).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});

    const data = `${partes.year}-${partes.month}-${partes.day}`;
    const hora = `${partes.hour}:${partes.minute}:${partes.second}`;
    return { data, hora, iso: `${data}T${hora}` };
}

/** Dia da semana (0=domingo ... 6=sábado) de uma data 'YYYY-MM-DD', sem depender de timezone do processo. */
function diaDaSemana(dataISO) {
    return new Date(`${dataISO}T12:00:00Z`).getUTCDay();
}

/** true se a data (YYYY-MM-DD) cai em domingo. */
function ehDomingo(dataISO) {
    return diaDaSemana(dataISO) === 0;
}

/**
 * Mapeia a data para um dos 6 dias configuráveis individualmente por funcionário
 * ('segunda' ... 'sabado'). Domingo retorna null — nunca é configurável, sempre descanso.
 */
function grupoDoDia(dataISO) {
    const d = diaDaSemana(dataISO);
    if (d === 0) return null; // domingo
    return DIAS_SEMANA[d - 1]; // 1=segunda ... 6=sabado
}

/** Formata 'YYYY-MM-DD' para exibição 'DD/MM/YYYY'. */
function formatarDataBR(dataISO) {
    if (!dataISO) return '';
    const [a, m, d] = dataISO.split('-');
    return `${d}/${m}/${a}`;
}

module.exports = {
    TIPO_PARA_CHAVE,
    TIPOS_VALIDOS,
    DIAS_SEMANA,
    INICIO_NOTURNO_MIN,
    FIM_NOTURNO_MIN,
    paraMinutos,
    minutosParaStr,
    agoraBrasilia,
    diaDaSemana,
    ehDomingo,
    grupoDoDia,
    formatarDataBR
};
