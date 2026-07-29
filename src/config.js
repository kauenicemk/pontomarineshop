/**
 * Valores padrão do sistema.
 *
 * Os ajustáveis por ambiente (limiar da biometria e jornada mensal de referência) vêm das
 * `[vars]` do wrangler.toml. Atenção: no Cloudflare Workers essas variáveis chegam pelo
 * binding `env` de cada requisição, NÃO por `process.env` — que fica vazio. Antes este
 * arquivo lia de `process.env`, então o que estivesse no wrangler.toml era silenciosamente
 * ignorado e o sistema sempre usava o default. Por isso existe o `aplicarVarsDoAmbiente()`,
 * chamado uma vez no início da requisição (ver public/_worker.js).
 */

const config = {
    // Regras padrao usadas so para PREENCHER a jornada de um funcionario recem-criado
    // (depois cada um dos 6 dias -- segunda a sabado -- eh configuravel individualmente
    // na tela de Administracao > Configurar Horarios).
    jornada: {
        metaMinutosCLT: 480,        // 8h
        metaMinutosEstagiario: 360, // 6h
        metaMinutosSextaPadrao: 360,// sexta-feira reduzida por padrao (ajustavel por pessoa depois)
        // TOLERANCIA DE ENTRADA (regra da empresa): ate 10 minutos de atraso NAO conta
        // como atraso e NAO desconta do saldo -- esta dentro da tolerancia, entao e como
        // se a pessoa tivesse chegado no horario. Passou de 10 minutos, o atraso inteiro
        // conta E desconta do saldo (nao so o excedente).
        //   8 min  -> atraso 00:00, saldo intacto
        //   12 min -> atraso 00:12, saldo -12
        toleranciaEntradaMin: 10,

        // TOLERANCIA DE ALMOCO: um minuto de folga alem do tempo de almoco combinado
        // (o combinado fica em tolerancia_almoco_min, por funcionario). Passou disso,
        // o excedente conta como atraso E desconta do saldo -- aqui nao ha perdao,
        // diferente da entrada.
        //   almoco de 60min + 1min  -> sem atraso
        //   almoco de 60min + 5min  -> atraso 00:04 (5 - 1) e saldo -4
        toleranciaAlmocoMin: 1
    },

    // Percentuais padrao de hora extra e adicional noturno (tambem editaveis via tabela
    // config_horas_extras). Sabado agora conta como "dia_util" pra fins de hora extra --
    // so domingo e feriado tem percentual diferenciado. O adicional noturno eh calculado
    // à parte (nao eh so pra quem fez hora extra: incide sobre qualquer minuto trabalhado
    // dentro da janela 22h-5h, mesmo dentro da jornada normal).
    horasExtrasPadrao: {
        dia_util: 0.60,
        domingo_feriado: 1.00,
        adicional_noturno: 0.20
    },

    // Reconhecimento facial: o descritor eh um vetor de numeros (nunca guardamos a foto em si).
    // O limiar eh a distancia euclidiana maxima aceita entre o rosto capturado na hora e uma
    // amostra cadastrada -- quanto MENOR, mais rigoroso (mais chance de nao reconhecer gente
    // conhecida); quanto MAIOR, mais permissivo (mais chance de confundir duas pessoas parecidas).
    // 0.5 eh um valor conservador; o padrao usual da lib face-api.js e 0.6.
    // Ajustavel por BIOMETRIA_LIMIAR no wrangler.toml.
    biometria: {
        tamanhoDescritor: 128,
        limiarDistancia: 0.5
    },

    // Usado pra converter salario_base em valor-hora (salario / jornada mensal em horas).
    // 220h eh a referencia mais comum no mercado brasileiro pra jornada de 44h semanais
    // (44 * 5 semanas "medias" no mes). Ajustavel por JORNADA_MENSAL_HORAS no wrangler.toml.
    jornadaMensalHorasPadrao: 220,

    // Dias corridos de descanso minimo exigidos entre o fim de um turno e o inicio do proximo
    // (Art. 66 da CLT - intervalo interjornada). 11h = 660 minutos.
    minutosMinimosInterjornada: 11 * 60
};

/** Lê um número do ambiente, mantendo o padrão se estiver ausente ou inválido. */
function numeroDoAmbiente(valor, padrao) {
    const n = parseFloat(valor);
    return Number.isFinite(n) && n > 0 ? n : padrao;
}

/**
 * Aplica as `[vars]` do wrangler.toml sobre os padrões. Idempotente: pode ser chamada
 * em toda requisição sem efeito colateral.
 */
function aplicarVarsDoAmbiente(env) {
    if (!env) return config;
    config.biometria.limiarDistancia = numeroDoAmbiente(env.BIOMETRIA_LIMIAR, 0.5);
    config.jornadaMensalHorasPadrao = numeroDoAmbiente(env.JORNADA_MENSAL_HORAS, 220);
    return config;
}

module.exports = config;
module.exports.aplicarVarsDoAmbiente = aplicarVarsDoAmbiente;
