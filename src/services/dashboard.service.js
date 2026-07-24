const db = require('../db/db');
const { agoraBrasilia } = require('../utils/tempo');
const pontoService = require('./ponto.service');
const feriasService = require('./ferias.service');
const relatorioService = require('./relatorio.service');

/** Resumo do dia pro dashboard administrativo — junta dados que já existem em outros services. */
async function resumoDoDia() {
    const { data: hoje } = agoraBrasilia();

    const [pendencias, feriasAgora, diasHoje, totalAtivos] = await Promise.all([
        pontoService.pendenciasDoDia(),
        feriasService.quemEstaDeFeriasAgora(),
        relatorioService.relatorioCalculado({ dataInicio: hoje, dataFim: hoje }),
        db.get(`SELECT COUNT(*) as total FROM funcionarios WHERE ativo = 1`)
    ]);

    const trabalhando = pendencias.presentesAgora.filter((p) => p.status === 'Trabalhando').length;
    const emIntervalo = pendencias.presentesAgora.filter((p) => p.status === 'Em Almoço').length;
    const atrasados = pendencias.naoChegaram.filter((p) => p.atrasado).length;
    const encerraram = diasHoje.filter((d) => d.pontos && d.pontos.SAIDA).length;
    const minutosExtraHoje = diasHoje.reduce((soma, d) => soma + (d.horas_extras.minutos || 0), 0);

    return {
        data: hoje,
        totalAtivos: totalAtivos.total,
        presentes: trabalhando,
        emIntervalo,
        encerraramExpediente: encerraram,
        atrasados,
        aindaNaoChegaram: pendencias.naoChegaram.length,
        deFerias: feriasAgora.length,
        horasExtraHojeMinutos: minutosExtraHoje
    };
}

module.exports = { resumoDoDia };
