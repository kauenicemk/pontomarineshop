import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome } from '../utils.js';

let cacheRelatorioGestor = [];

export function popularSeletorAjuste(funcionarios) {
    const sel = document.getElementById('select-f-ajuste');
    sel.innerHTML = '<option value="">Escolha...</option>' +
        funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)} (${escapeHtml(f.regime)})</option>`).join('');
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
function formatarDataBR(dataISO) {
    return String(dataISO || '').split('-').reverse().join('/');
}

/** Data de N dias atrás, em ISO — usada para não pedir o histórico inteiro de uma vez. */
function diasAtras(dias) {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
}

export async function carregarGavetasGerais() {
    const espaco = document.getElementById('espaco-gavetas');
    espaco.innerHTML = '<p class="texto-vazio">Carregando...</p>';

    try {
        // Últimos 30 dias por padrão. Antes esta tela pedia o histórico inteiro sem filtro:
        // com o tempo isso vira milhares de linhas baixadas a cada visita, para mostrar
        // gavetas que ninguém abre além das mais recentes. O período completo continua
        // disponível no Relatório Consolidado e no Relatório Individual.
        const dados = await api.historicoGeral(diasAtras(30), '');
        const agrupadosPorDia = {};
        dados.forEach((d) => {
            if (!agrupadosPorDia[d.data]) agrupadosPorDia[d.data] = {};
            if (!agrupadosPorDia[d.data][d.nome]) {
                agrupadosPorDia[d.data][d.nome] = { emoji: d.emoji, Ent: '---', S_Alm: '---', V_Alm: '---', Sai: '---' };
            }
            const chave = { 'Entrada': 'Ent', 'Saída Almoço': 'S_Alm', 'Retorno Almoço': 'V_Alm', 'Saída Final': 'Sai' }[d.tipo];
            if (chave) agrupadosPorDia[d.data][d.nome][chave] = (d.hora || '').substring(0, 5);
        });

        espaco.innerHTML = '';
        Object.keys(agrupadosPorDia).sort((a, b) => b.localeCompare(a)).forEach((data) => {
            const div = document.createElement('div'); div.className = 'gaveta-container';
            const header = document.createElement('div'); header.className = 'gaveta-header';
            const total = Object.keys(agrupadosPorDia[data]).length;
            header.innerHTML = `<span>${escapeHtml(formatarDataBR(data))}</span> <span>${total} colaborador(es)</span>`;

            const cont = document.createElement('div'); cont.className = 'gaveta-conteudo';
            Object.keys(agrupadosPorDia[data]).forEach((nome) => {
                const obj = agrupadosPorDia[data][nome];
                cont.innerHTML += `
                    <div class="colaborador-linha-gaveta">
                        <span class="info-nome">${escapeHtml(obj.emoji)} ${escapeHtml(primeiroNome(nome))}</span>
                        <div class="info-horarios">
                            <span>Entrada: <b>${escapeHtml(obj.Ent)}</b></span>
                            <span>S. Almoço: <b>${escapeHtml(obj.S_Alm)}</b></span>
                            <span>V. Almoço: <b>${escapeHtml(obj.V_Alm)}</b></span>
                            <span>Saída: <b>${escapeHtml(obj.Sai)}</b></span>
                        </div>
                    </div>`;
            });

            header.addEventListener('click', () => cont.classList.toggle('open'));
            div.appendChild(header); div.appendChild(cont); espaco.appendChild(div);
        });
    } catch (e) {
        espaco.innerHTML = `<p style="color:var(--vermelho); font-size:13px;">${e.message === 'cancelado' ? 'Acesso cancelado.' : 'Erro ao carregar: ' + escapeHtml(e.message)}</p>`;
    }
}

/**
 * Faixa de atestados acima da tabela. O relatório coletivo é dia a dia, então a
 * contagem por pessoa não cabe numa coluna — vem como resumo, ordenado de quem
 * mais apresentou, que é a leitura que interessa.
 */
function renderizarResumoAtestados(dados) {
    const alvo = document.getElementById('gestor-resumo-atestados');
    if (!alvo) return;

    if (!dados || dados.total === 0) {
        alvo.classList.add('escondido');
        alvo.innerHTML = '';
        return;
    }

    const topo = dados.porFuncionario
        .map((r) => `${escapeHtml(primeiroNome(r.nome))} (${r.total})`)
        .join(' · ');

    alvo.classList.remove('escondido');
    alvo.innerHTML = `<b>${dados.total} atestado(s)</b> no período — ${dados.totalDiasInteiros} de dia inteiro,
        ${dados.totalDeHoras} de horas. ${topo}`;
}

/** Marca no relatório coletivo o que faz aquele dia fugir do padrão. */
function marcaDoDia(dia) {
    const partes = [];
    if (dia.troca) partes.push(dia.troca.papel === 'folga' ? 'folga trocada' : 'compensação');
    if (dia.escaladoNoSabado) partes.push('sábado escalado');
    if (dia.tratativa) {
        const rotulos = { atraso_abonado: 'abonado', atraso_registrado: 'justificado', atestado_horas: 'atestado' };
        partes.push(rotulos[dia.tratativa.tipo] || dia.tratativa.tipo);
    }
    return partes.length ? ` <span class="badge-manual">${escapeHtml(partes.join(', '))}</span>` : '';
}

export async function renderizarRelatorioGestor() {
    const tbody = document.getElementById('tabela-gestor-linhas');
    const inicio = document.getElementById('filtro-inicio').value;
    const fim = document.getElementById('filtro-fim').value;

    try {
        cacheRelatorioGestor = await api.relatorioCalculado(inicio, fim);
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
        return;
    }

    // Contagem de atestados do período. Falha aqui não pode derrubar o relatório:
    // é informação complementar, e o gestor precisa do quadro de horas de qualquer jeito.
    if (inicio && fim) {
        try {
            renderizarResumoAtestados(await api.listarAtestados(inicio, fim));
        } catch (_) {
            renderizarResumoAtestados(null);
        }
    } else {
        renderizarResumoAtestados(null);
    }

    tbody.innerHTML = cacheRelatorioGestor.length ? '' : '<tr><td colspan="12" style="color:var(--texto-mudo)">Nenhum registro no período.</td></tr>';

    cacheRelatorioGestor.forEach((dia) => {
        const j = dia.justificativas;
        const cel = (t) => {
            const h = dia.pontos[t] || '---';
            return j[t] ? `${escapeHtml(h)} <span class="badge-manual" title="${escapeHtml(j[t])}">ajuste</span>` : escapeHtml(h);
        };
        const extra60 = dia.horas_extras.tipo === 'dia_util' && dia.horas_extras.tempo !== '00:00' ? `<b>${escapeHtml(dia.horas_extras.tempo)}</b>` : '---';
        const extra100 = dia.horas_extras.tipo === 'domingo_feriado' && dia.horas_extras.tempo !== '00:00' ? `<b>${escapeHtml(dia.horas_extras.tempo)}</b>` : '---';
        const linha = document.createElement('tr');
        linha.innerHTML = `
            <td>${escapeHtml(dia.emoji)} ${escapeHtml(primeiroNome(dia.nome))}</td>
            <td style="white-space:normal">${escapeHtml(dia.data.substring(0, 5))}${dia.ehFeriado ? ' (fer.)' : ''}${marcaDoDia(dia)}</td>
            <td>${cel('ENTRADA')}</td><td>${cel('ALMOCO_SAIDA')}</td><td>${cel('ALMOCO_RETORNO')}</td><td>${cel('SAIDA')}</td>
            <td><b>${escapeHtml(dia.tempo_trabalhado)}</b></td>
            <td style="color:${dia.atrasoDescontavelMinutos > 0 ? 'var(--vermelho)' : (dia.atrasoMinutos > 0 ? 'var(--amarelo)' : 'var(--texto)')}"
                title="${dia.atrasoDentroDoLimiar ? 'Abaixo de 11 min no dia: registrado, sem desconto' : ''}"><b>${escapeHtml(dia.atraso)}</b></td>
            <td style="color:${dia.saldo.startsWith('+') ? 'var(--verde)' : 'var(--vermelho)'}"><b>${escapeHtml(dia.saldo)}</b></td>
            <td>${extra60}</td>
            <td>${extra100}</td>
            <td>${dia.horas_noturnas.tempo !== '00:00' ? `<b>${escapeHtml(dia.horas_noturnas.tempo)}</b>` : '---'}</td>
        `;
        tbody.appendChild(linha);
    });
}

// O lançamento manual de ponto agora mora em tabs/editorPontos.js, junto com a
// correção e a exclusão de batidas — antes só era possível INSERIR, nunca corrigir.

export function exportarPlanilhaParaExcel() {
    if (cacheRelatorioGestor.length === 0) {
        toast('Não há dados consolidados para exportar!', 'erro');
        return;
    }

    let csv = '\ufeff';
    csv += 'Nome;Data;Horario Combinado;Entrada;Saida Almoco;Retorno Almoco;Saida Final;Tempo Trabalhado;Atraso Registrado;Atraso Descontado;Saldo;Hora Extra 60%;Hora Extra 100%;Extra Pagavel;Horas Noturnas;Ocorrencia\n';
    cacheRelatorioGestor.forEach((dia) => {
        const p = dia.pontos;
        const extra60 = dia.horas_extras.tipo === 'dia_util' ? dia.horas_extras.tempo : '00:00';
        const extra100 = dia.horas_extras.tipo === 'domingo_feriado' ? dia.horas_extras.tempo : '00:00';
        const min = (m) => `${String(Math.floor((m || 0) / 60)).padStart(2, '0')}:${String((m || 0) % 60).padStart(2, '0')}`;
        const ocorrencia = [
            dia.troca ? (dia.troca.papel === 'folga' ? 'folga trocada' : 'compensacao') : '',
            dia.escaladoNoSabado ? 'sabado escalado' : '',
            dia.tratativa ? dia.tratativa.tipo : ''
        ].filter(Boolean).join(' + ');
        csv += `${dia.nome};${dia.data};${dia.horario_combinado};${p.ENTRADA || '---'};${p.ALMOCO_SAIDA || '---'};${p.ALMOCO_RETORNO || '---'};${p.SAIDA || '---'};${dia.tempo_trabalhado};${dia.atraso};${min(dia.atrasoDescontavelMinutos)};${dia.saldo};${extra60};${extra100};${min(dia.horas_extras.minutosPagos)};${dia.horas_noturnas.tempo};${ocorrencia}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Relatorio_Consolidado_Ponto.csv';
    link.style.visibility = 'hidden'; // corrigido: antes havia "style=" solto por engano no original
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

export function getCacheRelatorioGestor() {
    return cacheRelatorioGestor;
}
