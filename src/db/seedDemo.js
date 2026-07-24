/**
 * Seed de DEMONSTRAÇÃO — dados fictícios e ALEATÓRIOS, só para ver o sistema funcionando com
 * volume de dados (relatórios, banco de horas, faltas, etc). Roda de novo gera gente diferente
 * (é por isso que é "volátil" — não é um dataset fixo).
 *
 * NÃO use isto em produção. Cadastre os funcionários reais pela aba Administração (ou pela API
 * /api/funcionarios), nunca direto no código-fonte.
 *
 * Rodar com: npm run seed:demo
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const { migrar } = require('./migrate');
const { agoraBrasilia, DIAS_SEMANA } = require('../utils/tempo');

const NOMES = [
    ['🧢', 'Ana Souza'], ['⚡', 'Bruno Lima'], ['🐣', 'Carla Dias'], ['🦒', 'Diego Rocha'],
    ['🌵', 'Elisa Martins'], ['🎧', 'Fábio Alves'], ['🍀', 'Gabriela Nunes'], ['🛰️', 'Hugo Pereira'],
    ['🌊', 'Isabela Costa'], ['🔥', 'João Ramos'], ['🌙', 'Karina Melo'], ['⭐', 'Lucas Freitas']
];

function aleatorio(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function escolher(lista) { return lista[aleatorio(0, lista.length - 1)]; }

function horaComJitter(horarioBase, jitterMin) {
    const [h, m] = horarioBase.split(':').map(Number);
    const totalMin = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + aleatorio(-jitterMin, jitterMin)));
    return `${String(Math.floor(totalMin / 60)).padStart(2, '0')}:${String(totalMin % 60).padStart(2, '0')}`;
}

function somarMinutos(horario, minutos) {
    const [h, m] = horario.split(':').map(Number);
    const total = Math.max(0, Math.min(23 * 60 + 59, h * 60 + m + minutos));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const DEPARTAMENTOS = ['Comercial', 'Operações', 'TI', 'Financeiro', 'RH'];

/** Data de admissão aleatória entre 1 e 4 anos atrás — pra mostrar diferentes situações de férias. */
function dataAdmissaoAleatoria() {
    const hoje = new Date(`${agoraBrasilia().data}T12:00:00Z`);
    const diasAtras = aleatorio(365, 365 * 4);
    const d = new Date(hoje);
    d.setUTCDate(d.getUTCDate() - diasAtras);
    return d.toISOString().slice(0, 10);
}

/** Insere um registro de ponto numa data/hora ARBITRÁRIA do passado (a rota normal só bate "agora"). */
async function inserirRegistroHistorico(funcionarioId, dataISO, hora, tipo) {
    await db.run(
        `INSERT INTO registro_ponto (funcionario_id, data, hora, data_hora_iso, tipo) VALUES (?, ?, ?, ?, ?)`,
        [funcionarioId, dataISO, `${hora}:00`, `${dataISO}T${hora}:00`, tipo]
    );
}

function listarUltimos30Dias() {
    const dias = [];
    const hoje = new Date(`${agoraBrasilia().data}T12:00:00Z`);
    for (let i = 30; i >= 1; i--) {
        const d = new Date(hoje);
        d.setUTCDate(d.getUTCDate() - i);
        dias.push(d.toISOString().slice(0, 10));
    }
    return dias;
}

function diaDaSemanaISO(dataISO) {
    return new Date(`${dataISO}T12:00:00Z`).getUTCDay();
}

async function gerarHistoricoDoFuncionario(funcionario, jornadaPorDia, todosDias) {
    for (const dataISO of todosDias) {
        const dow = diaDaSemanaISO(dataISO);
        if (dow === 0) continue; // domingo nunca trabalha

        const grupo = DIAS_SEMANA[dow - 1];
        const cfg = jornadaPorDia[grupo];
        if (!cfg || !cfg.trabalha) continue;

        const sorte = Math.random();

        if (sorte < 0.05) {
            continue; // falta não justificada (propositalmente sem registro nenhum)
        }

        if (sorte < 0.10) {
            // ausência justificada
            const tipos = ['atestado', 'ferias', 'licenca', 'folga'];
            await db.run(
                `INSERT OR IGNORE INTO ausencias (funcionario_id, data, tipo, justificativa) VALUES (?, ?, ?, ?)`,
                [funcionario.id, dataISO, escolher(tipos), 'Gerado pelo seed de demonstração']
            );
            continue;
        }

        // Dia normal trabalhado, com variações aleatórias de atraso/hora extra.
        const atrasoEntrada = sorte < 0.25 ? aleatorio(5, 35) : aleatorio(-5, 5);
        const entrada = somarMinutos(cfg.horario_entrada, atrasoEntrada);

        const inicioAlmoco = somarMinutos(entrada, (cfg.meta_minutos / 2) | 0 || 240);
        const almocoSaida = horaComJitter(inicioAlmoco, 10);
        const almocoRetorno = somarMinutos(almocoSaida, aleatorio(50, 70));

        const fazHoraExtra = sorte > 0.85;
        const minutosTrabalhoTarde = (cfg.meta_minutos / 2) | 0 || 240;
        const extra = fazHoraExtra ? aleatorio(30, 150) : aleatorio(-5, 10);
        const saidaFinal = somarMinutos(almocoRetorno, minutosTrabalhoTarde + extra);

        await inserirRegistroHistorico(funcionario.id, dataISO, entrada, 'Entrada');
        await inserirRegistroHistorico(funcionario.id, dataISO, almocoSaida, 'Saída Almoço');
        await inserirRegistroHistorico(funcionario.id, dataISO, almocoRetorno, 'Retorno Almoço');
        await inserirRegistroHistorico(funcionario.id, dataISO, saidaFinal, 'Saída Final');
    }
}

async function seed() {
    await migrar();

    const totalAtual = await db.get('SELECT COUNT(*) as total FROM funcionarios');
    if (totalAtual.total > 0) {
        console.log('Já existem funcionários cadastrados — seed de demonstração não foi aplicado.');
        return;
    }

    const qtdFuncionarios = aleatorio(10, 12);
    const nomesEscolhidos = [...NOMES].sort(() => Math.random() - 0.5).slice(0, qtdFuncionarios);

    const funcionariosCriados = [];

    for (const [emoji, nome] of nomesEscolhidos) {
        const regime = Math.random() < 0.75 ? 'CLT' : Math.random() < 0.7 ? 'ESTAGIARIO' : 'PJ';
        const trabalhaSabado = Math.random() < 0.35;
        const horarioEntradaBase = escolher(['07:00', '08:00', '08:30', '09:00']);
        const pin = String(aleatorio(1000, 9999));
        const pinHash = await bcrypt.hash(pin, 10);
        const dataAdmissao = dataAdmissaoAleatoria();
        const salarioBase = Math.random() < 0.8 ? aleatorio(1800, 6500) : null; // ~20% sem salário, pra mostrar o aviso nos indicadores
        const departamento = Math.random() < 0.85 ? escolher(DEPARTAMENTOS) : null;

        const { lastID } = await db.run(
            `INSERT INTO funcionarios (emoji, nome, regime, horas_diarias, pin_hash, tolerancia_almoco_min, almoco_flexivel, data_admissao, salario_base, departamento)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [emoji, nome, regime, regime === 'ESTAGIARIO' ? '6h' : regime === 'PJ' ? 'Flex' : '8h', pinHash,
                regime === 'ESTAGIARIO' ? 15 : 60, Math.random() < 0.15 ? 1 : 0, dataAdmissao, salarioBase, departamento]
        );

        const metaPadrao = regime === 'CLT' ? 480 : regime === 'ESTAGIARIO' ? 360 : 480;
        const metaSexta = Math.min(metaPadrao, 360);

        const jornadaPorDia = {
            segunda: { horario_entrada: horarioEntradaBase, meta_minutos: metaPadrao, trabalha: 1 },
            terca: { horario_entrada: horarioEntradaBase, meta_minutos: metaPadrao, trabalha: 1 },
            quarta: { horario_entrada: horarioEntradaBase, meta_minutos: metaPadrao, trabalha: 1 },
            quinta: { horario_entrada: horarioEntradaBase, meta_minutos: metaPadrao, trabalha: 1 },
            sexta: { horario_entrada: horarioEntradaBase, meta_minutos: metaSexta, trabalha: 1 },
            sabado: { horario_entrada: horarioEntradaBase, meta_minutos: trabalhaSabado ? 240 : 0, trabalha: trabalhaSabado ? 1 : 0 }
        };

        for (const grupo of DIAS_SEMANA) {
            const cfg = jornadaPorDia[grupo];
            await db.run(
                `INSERT INTO jornada_funcionario (funcionario_id, grupo_dia, horario_entrada, meta_minutos, trabalha) VALUES (?, ?, ?, ?, ?)`,
                [lastID, grupo, cfg.horario_entrada, cfg.meta_minutos, cfg.trabalha]
            );
        }

        funcionariosCriados.push({ id: lastID, emoji, nome, regime, pin, jornadaPorDia });
    }

    // Um funcionário noturno de exemplo, pra mostrar o adicional noturno em ação (turno 22h-23h59 do mesmo dia).
    const [emojiNoturno, nomeNoturno] = ['🌌', 'Vitor Noturno (exemplo turno da noite)'];
    const pinNoturno = String(aleatorio(1000, 9999));
    const jornadaNoturna = {
        segunda: { horario_entrada: '14:00', meta_minutos: 480, trabalha: 1 },
        terca: { horario_entrada: '14:00', meta_minutos: 480, trabalha: 1 },
        quarta: { horario_entrada: '14:00', meta_minutos: 480, trabalha: 1 },
        quinta: { horario_entrada: '14:00', meta_minutos: 480, trabalha: 1 },
        sexta: { horario_entrada: '14:00', meta_minutos: 480, trabalha: 1 },
        sabado: { horario_entrada: '14:00', meta_minutos: 0, trabalha: 0 }
    };
    const { lastID: idNoturno } = await db.run(
        `INSERT INTO funcionarios (emoji, nome, regime, horas_diarias, pin_hash, tolerancia_almoco_min, almoco_flexivel, data_admissao, salario_base, departamento)
         VALUES (?, ?, 'CLT', '8h', ?, 60, 0, ?, ?, 'Operações')`,
        [emojiNoturno, nomeNoturno, await bcrypt.hash(pinNoturno, 10), dataAdmissaoAleatoria(), aleatorio(2200, 3500)]
    );
    for (const grupo of DIAS_SEMANA) {
        const cfg = jornadaNoturna[grupo];
        await db.run(
            `INSERT INTO jornada_funcionario (funcionario_id, grupo_dia, horario_entrada, meta_minutos, trabalha) VALUES (?, ?, ?, ?, ?)`,
            [idNoturno, grupo, cfg.horario_entrada, cfg.meta_minutos, cfg.trabalha]
        );
    }
    funcionariosCriados.push({ id: idNoturno, emoji: emojiNoturno, nome: nomeNoturno, regime: 'CLT', pin: pinNoturno, jornadaPorDia: jornadaNoturna });

    // Um feriado no último mês, pra aparecer no relatório e no cálculo de faltas/extras.
    const dias30 = listarUltimos30Dias();
    const feriadoExemplo = dias30[aleatorio(5, 25)];
    await db.run(
        `INSERT OR IGNORE INTO feriados (data, nome, abrangencia) VALUES (?, 'Feriado de exemplo (seed)', 'empresa')`,
        [feriadoExemplo]
    );

    console.log(`Gerando histórico de ponto dos últimos 30 dias para ${funcionariosCriados.length} funcionários...`);
    for (const f of funcionariosCriados) {
        await gerarHistoricoDoFuncionario(f, f.jornadaPorDia, dias30);
    }

    console.log(`✅ Seed de demonstração aplicado: ${funcionariosCriados.length} funcionários fictícios, com ~30 dias de histórico de ponto (dados aleatórios).`);
    console.log('   Cada um já tem data de admissão (então a aba Férias já calcula os períodos sozinha),');
    console.log('   e a maioria tem salário-base e departamento (pra ver os Indicadores com dados de verdade).');
    console.log('PINs de demonstração:');
    funcionariosCriados.forEach((f) => console.log(`  ${f.emoji} ${f.nome} — PIN: ${f.pin}`));
}

seed()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Erro ao aplicar seed de demonstração:', err);
        process.exit(1);
    });
