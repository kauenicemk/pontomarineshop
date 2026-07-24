import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, primeiroNome } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';

let cacheRelatorioGestor = [];

export function popularSeletorAjuste(funcionarios) {
    const sel = document.getElementById('select-f-ajuste');
    sel.innerHTML = '<option value="">Escolha...</option>' +
        funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)} (${escapeHtml(f.regime)})</option>`).join('');
}

export async function carregarGavetasGerais() {
    const espaco = document.getElementById('espaco-gavetas');
    espaco.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';

    try {
        const dados = await comAutorizacao(() => api.historicoGeral());
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
            header.innerHTML = `<span>📅 Dia: ${escapeHtml(data)}</span> <span>⬇ (${total} colaboradores ativos)</span>`;

            const cont = document.createElement('div'); cont.className = 'gaveta-conteudo';
            Object.keys(agrupadosPorDia[data]).forEach((nome) => {
                const obj = agrupadosPorDia[data][nome];
                cont.innerHTML += `
                    <div class="colaborador-linha-gaveta">
                        <span class="info-nome">${escapeHtml(obj.emoji)} ${escapeHtml(primeiroNome(nome))}</span>
                        <div class="info-horarios">
                            <span>🛫 Ent: <b>${escapeHtml(obj.Ent)}</b></span>
                            <span>🥪 S.Alm: <b>${escapeHtml(obj.S_Alm)}</b></span>
                            <span>📥 V.Alm: <b>${escapeHtml(obj.V_Alm)}</b></span>
                            <span>🛬 Sai: <b>${escapeHtml(obj.Sai)}</b></span>
                        </div>
                    </div>`;
            });

            header.addEventListener('click', () => cont.classList.toggle('open'));
            div.appendChild(header); div.appendChild(cont); espaco.appendChild(div);
        });
    } catch (e) {
        espaco.innerHTML = `<p style="color:#f87171; font-size:13px;">${e.message === 'cancelado' ? 'Acesso cancelado.' : 'Erro ao carregar: ' + escapeHtml(e.message)}</p>`;
    }
}

export async function renderizarRelatorioGestor() {
    const tbody = document.getElementById('tabela-gestor-linhas');
    const inicio = document.getElementById('filtro-inicio').value;
    const fim = document.getElementById('filtro-fim').value;

    try {
        cacheRelatorioGestor = await comAutorizacao(() => api.relatorioCalculado(inicio, fim));
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
        return;
    }

    tbody.innerHTML = cacheRelatorioGestor.length ? '' : '<tr><td colspan="12" style="color:var(--texto-mudo)">Nenhum registro no período.</td></tr>';

    cacheRelatorioGestor.forEach((dia) => {
        const j = dia.justificativas;
        const cel = (t) => {
            const h = dia.pontos[t] || '---';
            return j[t] ? `${escapeHtml(h)} <span class="badge-manual" title="${escapeHtml(j[t])}">⚠️ Man.</span>` : escapeHtml(h);
        };
        const extra60 = dia.horas_extras.tipo === 'dia_util' && dia.horas_extras.tempo !== '00:00' ? `<b>${escapeHtml(dia.horas_extras.tempo)}</b>` : '---';
        const extra100 = dia.horas_extras.tipo === 'domingo_feriado' && dia.horas_extras.tempo !== '00:00' ? `<b>${escapeHtml(dia.horas_extras.tempo)}</b>` : '---';
        const linha = document.createElement('tr');
        linha.innerHTML = `
            <td>${escapeHtml(dia.emoji)} ${escapeHtml(primeiroNome(dia.nome))}</td>
            <td>${escapeHtml(dia.data.substring(0, 5))}${dia.ehFeriado ? ' 🎉' : ''}</td>
            <td>${cel('ENTRADA')}</td><td>${cel('ALMOCO_SAIDA')}</td><td>${cel('ALMOCO_RETORNO')}</td><td>${cel('SAIDA')}</td>
            <td><b>${escapeHtml(dia.tempo_trabalhado)}</b></td>
            <td style="color:${dia.atraso !== '00:00' ? '#ef4444' : 'var(--texto)'}"><b>${escapeHtml(dia.atraso)}</b></td>
            <td style="color:${dia.saldo.startsWith('+') ? '#22c55e' : '#ef4444'}"><b>${escapeHtml(dia.saldo)}</b></td>
            <td>${extra60}</td>
            <td>${extra100}</td>
            <td>${dia.horas_noturnas.tempo !== '00:00' ? `<b>🌙 ${escapeHtml(dia.horas_noturnas.tempo)}</b>` : '---'}</td>
        `;
        tbody.appendChild(linha);
    });
}

export async function salvarAjusteManual() {
    const funcionario_id = document.getElementById('select-f-ajuste').value;
    const data = document.getElementById('ajuste-data').value;
    const hora = document.getElementById('ajuste-hora').value;
    const tipo = document.getElementById('ajuste-tipo').value;
    const justificativa = document.getElementById('ajuste-justificativa').value;

    if (!funcionario_id || !data || !hora || !justificativa) {
        toast('Preencha todos os campos do ajuste!', 'erro');
        return;
    }

    try {
        const resp = await comAutorizacao(() => api.ajustarPonto({ funcionario_id, data, hora, tipo, justificativa }));
        toast(resp.message, 'sucesso');
        document.getElementById('ajuste-justificativa').value = '';
        carregarGavetasGerais();
        renderizarRelatorioGestor();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

export function exportarPlanilhaParaExcel() {
    if (cacheRelatorioGestor.length === 0) {
        toast('Não há dados consolidados para exportar!', 'erro');
        return;
    }

    let csv = '\ufeff';
    csv += 'Nome;Data;Horario Combinado;Entrada;Saida Almoco;Retorno Almoco;Saida Final;Tempo Trabalhado;Atrasos;Saldo;Hora Extra 60%;Hora Extra 100%;Horas Noturnas\n';
    cacheRelatorioGestor.forEach((dia) => {
        const p = dia.pontos;
        const extra60 = dia.horas_extras.tipo === 'dia_util' ? dia.horas_extras.tempo : '00:00';
        const extra100 = dia.horas_extras.tipo === 'domingo_feriado' ? dia.horas_extras.tempo : '00:00';
        csv += `${dia.nome};${dia.data};${dia.horario_combinado};${p.ENTRADA || '---'};${p.ALMOCO_SAIDA || '---'};${p.ALMOCO_RETORNO || '---'};${p.SAIDA || '---'};${dia.tempo_trabalhado};${dia.atraso};${dia.saldo};${extra60};${extra100};${dia.horas_noturnas.tempo}\n`;
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
