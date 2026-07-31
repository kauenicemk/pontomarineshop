import { api } from '../api.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';

/**
 * ATESTADOS — dia inteiro e atestado de horas na mesma tela.
 *
 * Eles são lançados em lugares diferentes (Faltas e Atrasos) porque a operação é
 * diferente, mas para acompanhar recorrência precisam ser lidos juntos: três atestados
 * de meio dia no mês contam tanto quanto três de dia inteiro.
 *
 * O ranking é por quantidade, do maior para o menor — é a ordem que responde à
 * pergunta que motiva esta tela.
 */

const ROTULOS_REGIME = { CLT: 'CLT', ESTAGIARIO: 'Estagiário', PJ: 'PJ' };

let dadosCache = null;

const dataBR = (iso) => String(iso || '').split('-').reverse().join('/');

function minutosParaTexto(min) {
    if (!min) return '—';
    return `${String(Math.floor(min / 60)).padStart(2, '0')}h${String(min % 60).padStart(2, '0')}`;
}

/** Período livre: o mês é só o atalho, mas recorrência se enxerga em janelas maiores. */
function periodoSelecionado() {
    const modo = document.getElementById('atestados-modo').value;
    if (modo === 'personalizado') {
        return {
            inicio: document.getElementById('atestados-inicio').value,
            fim: document.getElementById('atestados-fim').value
        };
    }

    const mes = document.getElementById('atestados-mes').value || mesAtualISO();
    const [ano, m] = mes.split('-').map(Number);

    if (modo === 'mes') {
        return { inicio: `${mes}-01`, fim: `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, '0')}` };
    }
    if (modo === 'trimestre') {
        const inicioMes = m - 2;
        const d = new Date(Date.UTC(ano, inicioMes - 1, 1));
        return {
            inicio: d.toISOString().slice(0, 10),
            fim: `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, '0')}`
        };
    }
    // ano: janeiro até o fim do mês escolhido
    return { inicio: `${ano}-01-01`, fim: `${mes}-${String(new Date(ano, m, 0).getDate()).padStart(2, '0')}` };
}

export async function carregarAtestados() {
    const { inicio, fim } = periodoSelecionado();
    const tbodyRanking = document.getElementById('lista-atestados-ranking');
    const tbodyDetalhe = document.getElementById('lista-atestados-detalhe');

    if (!inicio || !fim) {
        tbodyRanking.innerHTML = '<tr><td colspan="5" class="texto-vazio">Escolha o período.</td></tr>';
        return;
    }
    if (inicio > fim) {
        tbodyRanking.innerHTML = '<tr><td colspan="5" style="color:var(--vermelho)">A data inicial é depois da final.</td></tr>';
        return;
    }

    tbodyRanking.innerHTML = '<tr><td colspan="5" class="texto-vazio">Carregando...</td></tr>';
    tbodyDetalhe.innerHTML = '';

    try {
        dadosCache = await api.listarAtestados(inicio, fim);
    } catch (e) {
        tbodyRanking.innerHTML = `<tr><td colspan="5" style="color:var(--vermelho)">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    renderizarResumo();
    renderizarRanking();
    renderizarDetalhe();
}

function renderizarResumo() {
    document.getElementById('atestados-total').textContent = dadosCache.total;
    document.getElementById('atestados-dias-inteiros').textContent = dadosCache.totalDiasInteiros;
    document.getElementById('atestados-horas').textContent = dadosCache.totalDeHoras;
    document.getElementById('atestados-pessoas').textContent = dadosCache.colaboradoresComAtestado;
}

function filtroRegime() {
    return document.getElementById('atestados-regime').value;
}

function renderizarRanking() {
    const tbody = document.getElementById('lista-atestados-ranking');
    const regime = filtroRegime();
    const lista = dadosCache.porFuncionario.filter((r) => !regime || r.regime === regime);

    tbody.innerHTML = lista.length
        ? lista.map((r) => `
            <tr>
                <td>${escapeHtml(r.emoji || '')} ${escapeHtml(primeiroNome(r.nome))}
                    <span class="badge-turno">${escapeHtml(ROTULOS_REGIME[r.regime] || r.regime || '')}</span></td>
                <td><b>${r.total}</b></td>
                <td>${r.diasInteiros}</td>
                <td>${r.deHoras}${r.minutosAbonados > 0 ? ` <span style="color:var(--texto-mudo)">(${minutosParaTexto(r.minutosAbonados)})</span>` : ''}</td>
                <td style="white-space:normal; color:var(--texto-mudo)">${r.datas.map(dataBR).join(', ')}</td>
            </tr>`).join('')
        : '<tr><td colspan="5" class="texto-vazio">Nenhum atestado no período.</td></tr>';
}

function renderizarDetalhe() {
    const tbody = document.getElementById('lista-atestados-detalhe');
    const regime = filtroRegime();
    const lista = dadosCache.lista.filter((a) => !regime || a.regime === regime);

    tbody.innerHTML = lista.length
        ? lista.map((a) => `
            <tr>
                <td>${escapeHtml(a.emoji || '')} ${escapeHtml(primeiroNome(a.nome))}</td>
                <td>${dataBR(a.data)}</td>
                <td>${a.tipo === 'dia_inteiro'
                    ? '<span style="color:var(--amarelo)">Dia inteiro</span>'
                    : `<span style="color:var(--verde)">Horas</span> <span style="color:var(--texto-mudo)">${minutosParaTexto(a.minutos_abonados)}</span>`}</td>
                <td style="white-space:normal; color:var(--texto-mudo)">${escapeHtml(a.observacao || '—')}</td>
            </tr>`).join('')
        : '<tr><td colspan="4" class="texto-vazio">Nenhum atestado no período.</td></tr>';
}

function baixarCsv() {
    if (!dadosCache) return;
    const regime = filtroRegime();
    const lista = dadosCache.lista.filter((a) => !regime || a.regime === regime);

    const celula = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let csv = 'Colaborador;Regime;Data;Tipo;Minutos abonados;Observacao\n';
    lista.forEach((a) => {
        csv += [
            a.nome, ROTULOS_REGIME[a.regime] || a.regime || '', dataBR(a.data),
            a.tipo === 'dia_inteiro' ? 'Dia inteiro' : 'Horas',
            a.minutos_abonados || '', a.observacao || ''
        ].map(celula).join(';') + '\n';
    });

    // ﻿ (BOM) faz o Excel abrir o arquivo em UTF-8 e não quebrar os acentos.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `atestados_${dadosCache.periodo.inicio}_a_${dadosCache.periodo.fim}.csv`;
    link.click();
    URL.revokeObjectURL(url);
}

/** Datas soltas só aparecem no modo personalizado — o resto se deriva do mês. */
function aplicarModo() {
    const personalizado = document.getElementById('atestados-modo').value === 'personalizado';
    document.getElementById('atestados-campo-mes').classList.toggle('escondido', personalizado);
    document.getElementById('atestados-campos-datas').classList.toggle('escondido', !personalizado);
}

export function iniciarAtestados() {
    const btn = document.getElementById('btn-filtrar-atestados');
    if (!btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';

    const mesInput = document.getElementById('atestados-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();

    btn.addEventListener('click', carregarAtestados);
    document.getElementById('atestados-modo').addEventListener('change', () => { aplicarModo(); carregarAtestados(); });
    document.getElementById('atestados-regime').addEventListener('change', () => {
        if (dadosCache) { renderizarRanking(); renderizarDetalhe(); }
    });
    document.getElementById('btn-csv-atestados').addEventListener('click', baixarCsv);

    aplicarModo();
}
