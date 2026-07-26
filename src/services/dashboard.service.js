const db = require('../db/db');
const { agoraBrasilia } = require('../utils/tempo');
const pontoService = require('./ponto.service');
const feriasService = require('./ferias.service');
const relatorioService = require('./relatorio.service');

/**
 * Resumo do dia + a situação completa do time numa ÚNICA resposta.
 *
 * Antes o painel inicial chamava /dashboard-resumo e /pendencias a cada 30 segundos,
 * e o próprio /dashboard-resumo rodava pendenciasDoDia() de novo por dentro — ou seja,
 * a mesma consulta acontecia duas vezes por ciclo. Agora ela roda uma vez só e o
 * resultado vai junto na resposta, para o front reaproveitar sem uma segunda chamada.
 */
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
    const minutosExtraHoje = diasHoje.reduce((soma, d) => soma + (d.horas_extras.minutos || 0), 0);

    return {
        data: hoje,
        totalAtivos: totalAtivos.total,
        presentes: trabalhando,
        emIntervalo,
        encerraramExpediente: pendencias.encerraram.length,
        atrasados,
        aindaNaoChegaram: pendencias.naoChegaram.length,
        deFerias: feriasAgora.length,
        horasExtraHojeMinutos: minutosExtraHoje,
        pendencias // situação detalhada, para o front não precisar consultar de novo
    };
}

module.exports = { resumoDoDia };
