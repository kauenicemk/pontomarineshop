import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, mesAtualISO } from '../utils.js';
import { abrirEspelho } from './espelho.js';

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

function cartaoResumo(rotulo, valor, cor) {
    return `
        <div class="cartao-resumo">
            <span class="cartao-resumo-valor" style="color:${cor || 'var(--text-main)'}">${escapeHtml(valor)}</span>
            <span class="cartao-resumo-rotulo">${escapeHtml(rotulo)}</span>
        </div>`;
}

export async function carregarRelatorioIndividual() {
    const id = document.getElementById('individual-colaborador').value;
    const mes = document.getElementById('individual-mes').value || mesAtualISO();
    const resumo = document.getElementById('individual-resumo');
    const tbody = document.getElementById('individual-dias');

    if (!id) {
        resumo.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Selecione um colaborador para ver o relatório.</p>';
        tbody.innerHTML = '';
        return;
    }

    const { inicio, fim } = primeiroEUltimoDiaDoMes(mes);
    resumo.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
    tbody.innerHTML = '';

    let r;
    try {
        r = await api.relatorioIndividual(id, inicio, fim);
    } catch (e) {
        resumo.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:#f87171">${escapeHtml(e.message)}</p>`;
        return;
    }

    const corSaldo = r.saldoTotalMinutos >= 0 ? '#4ade80' : '#f87171';

    resumo.innerHTML = `
        <div class="cartoes-resumo">
            ${cartaoResumo('Saldo do mês', r.saldoTotal, corSaldo)}
            ${cartaoResumo('Dias trabalhados', String(r.diasTrabalhados))}
            ${cartaoResumo('Total de atrasos', r.atrasoTotal, r.atrasoTotalMinutos > 0 ? '#f87171' : undefined)}
            ${cartaoResumo('Dias com atraso', String(r.diasComAtraso))}
            ${cartaoResumo('Horas extras', r.horasExtrasTotal, '#4ade80')}
            ${cartaoResumo('Horas noturnas', r.horasNoturnasTotal, '#38bdf8')}
            ${cartaoResumo('Faltas não justificadas', String(r.totalFaltas), r.totalFaltas > 0 ? '#f87171' : '#4ade80')}
            ${cartaoResumo('Violações interjornada', String(r.violacoesInterjornada.length), r.violacoesInterjornada.length > 0 ? '#f87171' : '#4ade80')}
        </div>
        ${r.funcionario.temSalarioCadastrado ? `
            <div class="cartoes-resumo">
                ${cartaoResumo('Valor de hora extra', formatarReais(r.valorExtraTotal), '#fbbf24')}
                ${cartaoResumo('Valor de adic. noturno', formatarReais(r.valorNoturnoTotal), '#a78bfa')}
            </div>
        ` : `<div class="aviso-info">Sem salário-base cadastrado — os valores em R$ de hora extra e adicional noturno não aparecem. Cadastre em Configurar Horários.</div>`}
        ${r.violacoesInterjornada.length ? `
            <div class="aviso-info" style="border-color: rgba(248,113,113,.4)">
                ⚠️ Intervalo interjornada (mínimo 11h de descanso entre turnos) violado em:
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
                <td>${escapeHtml(d.data)}${d.ehFeriado ? ' 🎉' : ''}</td>
                <td>${escapeHtml(d.pontos.ENTRADA || '---')}</td>
                <td>${escapeHtml(d.pontos.SAIDA || '---')}</td>
                <td><b>${escapeHtml(d.tempo_trabalhado)}</b></td>
                <td style="color:${d.atraso !== '00:00' ? '#ef4444' : 'var(--texto)'}">${escapeHtml(d.atraso)}</td>
                <td style="color:${d.saldo.startsWith('+') ? '#22c55e' : '#ef4444'}">${escapeHtml(d.saldo)}</td>
                <td>${extra60}</td>
                <td>${extra100}</td>
                <td>${d.horas_noturnas.tempo !== '00:00' ? '🌙 ' + escapeHtml(d.horas_noturnas.tempo) : '---'}</td>
            </tr>`;
        }).join('')
        : '<tr><td colspan="9" style="color:var(--texto-mudo)">Nenhum registro no período.</td></tr>';

    if (r.faltas.length) {
        tbody.innerHTML += `<tr><td colspan="9" style="padding-top:14px; border-top:2px solid var(--border); color:var(--vermelho); font-weight:600;">Faltas não justificadas no período:</td></tr>` +
            r.faltas.map((f) => `<tr><td colspan="9" style="color:#ef4444">${escapeHtml(f.data.split('-').reverse().join('/'))}</td></tr>`).join('');
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

export function exportarRelatorioIndividualCSV() {
    const nomeSelecionado = document.getElementById('individual-colaborador').selectedOptions[0]?.textContent;
    const linhas = document.querySelectorAll('#individual-dias tr');
    if (!nomeSelecionado || linhas.length === 0) {
        toast('Carregue um relatório individual antes de exportar.', 'erro');
        return;
    }

    let csv = '\ufeff';
    csv += `Relatorio individual;${nomeSelecionado}\n\n`;
    csv += 'Data;Entrada;Saida;Trabalhado;Atraso;Saldo;Extra 60%;Extra 100%;Noturno\n';
    document.querySelectorAll('#individual-dias tr').forEach((tr) => {
        const celulas = [...tr.querySelectorAll('td')].map((td) => td.textContent.trim());
        if (celulas.length >= 9) csv += celulas.join(';') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Relatorio_Individual_${nomeSelecionado.replace(/\s+/g, '_')}.csv`;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
