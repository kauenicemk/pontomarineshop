import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, mesAtualISO } from '../utils.js';
import { abrirEspelho } from './espelho.js';

// Último relatório carregado. A exportação lê DAQUI — antes ela varria a tabela
// renderizada (querySelectorAll nas <tr>), o que quebrava em silêncio se as colunas
// mudassem e ainda arrastava junto as linhas de "faltas", que têm outro formato.
let ultimoRelatorio = null;

function formatarReais(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function popularSeletorIndividual(funcionarios) {
    const sel = document.getElementById('individual-colaborador');
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="">Selecione um colaborador...</option>' +
        funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</option>`).join('');
    if (valorAtual) sel.value = valorAtual;

    const mesInput = document.getElementById('individual-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();
}

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const inicio = `${mesISO}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesISO}-${String(ultimoDia).padStart(2, '0')}`;
    return { inicio, fim };
}

/**
 * Selo que explica por que aquele dia não segue o padrão. Sem isso, um atraso
 * abonado aparece como "00:00" sem motivo aparente e um domingo trabalhado
 * aparece sem hora extra — o gestor precisa ver o porquê na própria linha.
 */
function seloDoDia(d) {
    const selos = [];
    if (d.troca) {
        const par = String(d.troca.dataPar || '').split('-').reverse().join('/');
        selos.push(d.troca.papel === 'folga'
            ? `<span class="selo-ocorrencia selo-troca" title="Folga compensada trabalhando em ${par}">folga trocada</span>`
            : `<span class="selo-ocorrencia selo-troca" title="Compensando a folga de ${par}">compensação</span>`);
    }
    if (d.escalado) {
        selos.push('<span class="selo-ocorrencia selo-troca" title="Dia trabalhado por escala, fora da jornada normal">escalado</span>');
    }
    if (d.tratativa) {
        const t = d.tratativa;
        const titulo = escapeHtml(t.motivo || '');
        if (t.tipo === 'atraso_abonado') selos.push(`<span class="selo-ocorrencia selo-abonado" title="${titulo}">abonado</span>`);
        else if (t.tipo === 'atraso_registrado') selos.push(`<span class="selo-ocorrencia selo-registrado" title="${titulo}">justificado</span>`);
        else if (t.tipo === 'atestado_horas') selos.push(`<span class="selo-ocorrencia selo-abonado" title="${titulo}">atestado ${Math.floor(t.minutos_abonados / 60)}h${String(t.minutos_abonados % 60).padStart(2, '0')}</span>`);
    }
    return selos.join(' ');
}

function cartaoResumo(rotulo, valor, cor) {
    return `
        <div class="cartao-resumo">
            <span class="cartao-resumo-valor" style="color:${cor || 'var(--texto)'}">${escapeHtml(valor)}</span>
            <span class="cartao-resumo-rotulo">${escapeHtml(rotulo)}</span>
        </div>`;
}

export async function carregarRelatorioIndividual() {
    const id = document.getElementById('individual-colaborador').value;
    const mes = document.getElementById('individual-mes').value || mesAtualISO();
    const resumo = document.getElementById('individual-resumo');
    const tbody = document.getElementById('individual-dias');

    if (!id) {
        resumo.innerHTML = '<p style="color:var(--texto-mudo); font-size:13px;">Selecione um colaborador para ver o relatório.</p>';
        tbody.innerHTML = '';
        return;
    }

    const { inicio, fim } = primeiroEUltimoDiaDoMes(mes);
    resumo.innerHTML = '<p style="color:var(--texto-mudo); font-size:13px;">Carregando...</p>';
    tbody.innerHTML = '';

    let r;
    try {
        r = await api.relatorioIndividual(id, inicio, fim);
    } catch (e) {
        ultimoRelatorio = null;
        resumo.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    // Guarda o relatório para a exportação usar os DADOS, não o que está na tela.
    ultimoRelatorio = { dados: r, mes, nome: document.getElementById('individual-colaborador').selectedOptions[0]?.textContent || '' };

    const corSaldo = r.saldoTotalMinutos >= 0 ? 'var(--verde)' : 'var(--vermelho)';

    resumo.innerHTML = `
        <div class="cartoes-resumo">
            ${cartaoResumo('Saldo do mês', r.saldoTotal, corSaldo)}
            ${cartaoResumo('Dias trabalhados', String(r.diasTrabalhados))}
            ${cartaoResumo('Atraso registrado', r.atrasoTotal, r.atrasoTotalMinutos > 0 ? 'var(--amarelo)' : undefined)}
            ${cartaoResumo('Atraso descontado', r.atrasoDescontadoTotal, r.atrasoDescontadoTotalMinutos > 0 ? 'var(--vermelho)' : 'var(--verde)')}
            ${cartaoResumo('Dias com atraso', String(r.diasComAtraso))}
            ${cartaoResumo('Horas extras', r.horasExtrasTotal, 'var(--verde)')}
            ${cartaoResumo('Extras pagáveis', r.horasExtrasPagasTotal, 'var(--verde)')}
            ${cartaoResumo('Atestados', String(r.atestados ? r.atestados.total : 0), (r.atestados && r.atestados.total > 0) ? 'var(--azul)' : undefined)}
            ${cartaoResumo('Horas noturnas', r.horasNoturnasTotal, 'var(--azul)')}
            ${cartaoResumo('Faltas não justificadas', String(r.totalFaltas), r.totalFaltas > 0 ? 'var(--vermelho)' : 'var(--verde)')}
            ${cartaoResumo('Violações interjornada', String(r.violacoesInterjornada.length), r.violacoesInterjornada.length > 0 ? 'var(--vermelho)' : 'var(--verde)')}
        </div>
        ${(r.atrasoTotalMinutos > r.atrasoDescontadoTotalMinutos || r.horasExtrasTotalMinutos > r.horasExtrasPagasTotalMinutos) ? `
            <div class="aviso-info">
                ${r.diasComAtrasoSemDesconto > 0
                    ? `<b>${r.diasComAtrasoSemDesconto} dia(s)</b> tiveram atraso abaixo de 11 minutos: aparecem no relatório para acompanhar pontualidade, mas não descontam do saldo nem da folha. `
                    : ''}
                ${r.horasExtrasTotalMinutos > r.horasExtrasPagasTotalMinutos
                    ? `Extras de até 10 minutos no dia ficam registradas, mas não são pagas — a diferença entre "Horas extras" e "Extras pagáveis".`
                    : ''}
            </div>
        ` : ''}
        ${r.atestados && r.atestados.total > 0 ? `
            <div class="aviso-info">
                <b>${r.atestados.total} atestado(s)</b> no período:
                ${r.atestados.diasInteiros} de dia inteiro e ${r.atestados.deHoras} de horas${r.atestados.minutosAbonados > 0
                    ? ` (${Math.floor(r.atestados.minutosAbonados / 60)}h${String(r.atestados.minutosAbonados % 60).padStart(2, '0')} abonadas)` : ''}.
            </div>
        ` : ''}
        ${r.funcionario.temSalarioCadastrado ? `
            <div class="cartoes-resumo">
                ${cartaoResumo('Valor de hora extra', formatarReais(r.valorExtraTotal), 'var(--amarelo)')}
                ${cartaoResumo('Valor de adic. noturno', formatarReais(r.valorNoturnoTotal), 'var(--roxo)')}
            </div>
        ` : `<div class="aviso-info">Sem salário-base cadastrado — os valores em R$ de hora extra e adicional noturno não aparecem. Cadastre em Configurar Horários.</div>`}
        ${r.violacoesInterjornada.length ? `
            <div class="aviso-info" style="border-color: rgba(248,113,113,.4)">
                Intervalo interjornada (mínimo 11h de descanso entre turnos) violado em:
                ${r.violacoesInterjornada.map((v) => `${v.dataAnterior.split('-').reverse().join('/')} → ${v.dataAtual.split('-').reverse().join('/')} (só ${Math.floor(v.minutosDescanso / 60)}h${String(v.minutosDescanso % 60).padStart(2, '0')} de descanso)`).join('; ')}
            </div>
        ` : ''}
    `;

    tbody.innerHTML = r.dias.length
        ? r.dias.slice().sort((a, b) => b.dataISO.localeCompare(a.dataISO)).map((d) => {
            const extra60 = d.horas_extras.tipo === 'dia_util' && d.horas_extras.tempo !== '00:00' ? escapeHtml(d.horas_extras.tempo) : '---';
            const extra100 = d.horas_extras.tipo === 'domingo_feriado' && d.horas_extras.tempo !== '00:00' ? escapeHtml(d.horas_extras.tempo) : '---';
            return `
            <tr>
                <td style="white-space:normal">${escapeHtml(d.data)}${d.ehFeriado ? ' (feriado)' : ''} ${seloDoDia(d)}</td>
                <td>${escapeHtml(d.pontos.ENTRADA || '---')}</td>
                <td>${escapeHtml(d.pontos.SAIDA || '---')}</td>
                <td><b>${escapeHtml(d.tempo_trabalhado)}</b></td>
                <td style="color:${d.atraso !== '00:00' ? 'var(--vermelho)' : 'var(--texto)'}">${escapeHtml(d.atraso)}</td>
                <td style="color:${d.saldo.startsWith('+') ? 'var(--verde)' : 'var(--vermelho)'}">${escapeHtml(d.saldo)}</td>
                <td>${extra60}</td>
                <td>${extra100}</td>
                <td>${d.horas_noturnas.tempo !== '00:00' ? escapeHtml(d.horas_noturnas.tempo) : '---'}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="9" style="color:var(--texto-mudo)">Nenhum registro no período.</td></tr>';

    if (r.faltas.length) {
        tbody.innerHTML += `<tr><td colspan="9" style="padding-top:14px; border-top:2px solid var(--border); color:var(--vermelho); font-weight:600;">Faltas não justificadas no período:</td></tr>` +
            r.faltas.map((f) => `<tr><td colspan="9" style="color:var(--vermelho)">${escapeHtml(f.data.split('-').reverse().join('/'))}</td></tr>`).join('');
    }
}

export async function abrirEspelhoDoIndividual() {
    const sel = document.getElementById('individual-colaborador');
    const id = sel.value;
    if (!id) {
        toast('Selecione um colaborador antes de ver o espelho.', 'erro');
        return;
    }
    const nome = sel.selectedOptions[0].textContent;
    await abrirEspelho(id, nome, (funcionarioId, inicio, fim) => api.relatorioIndividual(funcionarioId, inicio, fim));
}

/** Escapa o separador e as quebras de linha para nao desalinhar as colunas do CSV. */
function celulaCsv(valor) {
    return String(valor ?? '').replace(/;/g, ',').replace(/\r?\n/g, ' ');
}

export function exportarRelatorioIndividualCSV() {
    if (!ultimoRelatorio) {
        toast('Gere um relatório antes de exportar.', 'erro');
        return;
    }

    const { dados: r, nome: nomeSelecionado, mes } = ultimoRelatorio;

    let csv = '\ufeff';
    csv += `Relatorio individual;${celulaCsv(nomeSelecionado)}\n`;
    csv += `Mes de referencia;${celulaCsv(mes)}\n\n`;

    csv += 'Data;Entrada;S.Almoco;V.Almoco;Saida;Trabalhado;Atraso;Saldo;Extra 60%;Extra 100%;Noturno;Feriado;Ocorrencia;Motivo\n';
    r.dias.slice().sort((a, b) => a.dataISO.localeCompare(b.dataISO)).forEach((d) => {
        csv += [
            d.data,
            d.pontos.ENTRADA || '', d.pontos.ALMOCO_SAIDA || '', d.pontos.ALMOCO_RETORNO || '', d.pontos.SAIDA || '',
            d.tempo_trabalhado, d.atraso, d.saldo,
            d.horas_extras.tipo === 'dia_util' ? d.horas_extras.tempo : '',
            d.horas_extras.tipo === 'domingo_feriado' ? d.horas_extras.tempo : '',
            d.horas_noturnas.tempo,
            d.ehFeriado ? 'sim' : '',
            [d.troca ? (d.troca.papel === 'folga' ? 'folga trocada' : 'compensacao') : '',
             d.tratativa ? d.tratativa.tipo : ''].filter(Boolean).join(' + '),
            d.tratativa ? (d.tratativa.motivo || '') : ''
        ].map(celulaCsv).join(';') + '\n';
    });

    csv += '\nTotais do periodo\n';
    csv += `Saldo do mes;${celulaCsv(r.saldoTotal)}\n`;
    csv += `Dias trabalhados;${r.diasTrabalhados}\n`;
    csv += `Total de atrasos;${celulaCsv(r.atrasoTotal)}\n`;
    csv += `Dias com atraso;${r.diasComAtraso}\n`;
    csv += `Horas extras;${celulaCsv(r.horasExtrasTotal)}\n`;
    csv += `Horas noturnas;${celulaCsv(r.horasNoturnasTotal)}\n`;
    csv += `Faltas nao justificadas;${r.totalFaltas}\n`;

    if (r.faltas.length) {
        csv += '\nFaltas nao justificadas\n';
        r.faltas.forEach((f) => { csv += `${celulaCsv(f.data.split('-').reverse().join('/'))}\n`; });
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Relatorio_Individual_${nomeSelecionado.replace(/[^\w]+/g, '_')}_${mes}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
