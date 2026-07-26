require('dotenv').config();
const path = require('path');

module.exports = {
    port: parseInt(process.env.PORT, 10) || 3000,
    // dbPath só faz sentido no caminho Node local antigo (server.js/sqlite3) — no Cloudflare
    // Worker não existe __dirname, então protege pra não quebrar o carregamento do módulo ali.
    dbPath: process.env.DB_PATH || (typeof __dirname !== 'undefined' ? path.join(__dirname, '..', 'data', 'ponto.db') : null),
    adminPinInicial: process.env.ADMIN_PIN_INICIAL || '1234',
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: process.env.NODE_ENV === 'production',

    // Regras padrao usadas so para PREENCHER a jornada de um funcionario recem-criado
    // (depois cada um dos 6 dias -- segunda a sabado -- eh configuravel individualmente
    // na tela de Administracao > Configurar Horarios).
    jornada: {
        metaMinutosCLT: 480,        // 8h
        metaMinutosEstagiario: 360, // 6h
        metaMinutosSextaPadrao: 360,// sexta-feira reduzida por padrao (ajustavel por pessoa depois)
        toleranciaAtrasoEntradaMin: 0, // minutos de carencia antes de CONTAR atraso de entrada

        // Regra da empresa: atraso de ate 10 minutos APARECE como atraso (para o gestor
        // acompanhar quem chega tarde com frequencia), mas NAO desconta do saldo do dia.
        // Passou de 10 minutos, o atraso inteiro desconta do saldo -- nao so o excedente.
        // Ex.: 8 min de atraso -> conta 8 min de atraso, saldo intacto.
        //      12 min de atraso -> conta 12 min de atraso e desconta os 12 do saldo.
        minutosAtrasoSemDescontoNoSaldo: 10
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
    biometria: {
        tamanhoDescritor: 128,
        limiarDistancia: parseFloat(process.env.BIOMETRIA_LIMIAR) || 0.5
    },

    // Usado pra converter salario_base em valor-hora (salario / jornada mensal em horas).
    // 220h eh a referencia mais comum no mercado brasileiro pra jornada de 44h semanais
    // (44 * 5 semanas "medias" no mes). Ajustavel se a convenção da empresa for outra.
    jornadaMensalHorasPadrao: parseFloat(process.env.JORNADA_MENSAL_HORAS) || 220,

    // Dias corridos de descanso minimo exigidos entre o fim de um turno e o inicio do proximo
    // (Art. 66 da CLT - intervalo interjornada). 11h = 660 minutos.
    minutosMinimosInterjornada: 11 * 60
};
