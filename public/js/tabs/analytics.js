import { api } from '../api.js';
import { escapeHtml, primeiroNome, mesAtualISO } from '../utils.js';

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const inicio = `${mesISO}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesISO}-${String(ultimoDia).padStart(2, '0')}`;
    return { inicio, fim };
}

function formatarReais(valor) {
    return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function cartao(rotulo, valor, cor) {
    return `<div class="cartao-resumo">
        <span class="cartao-resumo-valor" style="color:${cor || 'var(--texto)'}">${escapeHtml(String(valor))}</span>
        <span class="cartao-resumo-rotulo">${escapeHtml(rotulo)}</span>
    </div>`;
}

function barraProporcional(rotulo, valor, maximo, cor) {
    const pct = maximo > 0 ? Math.max(4, Math.round((valor / maximo) * 100)) : 0;
    return `
        <div class="barra-linha">
            <span class="barra-rotulo">${escapeHtml(rotulo)}</span>
            <div class="barra-fundo"><div class="barra-preenchida" style="width:${pct}%; background:${cor};"></div></div>
            <span class="barra-valor">${valor}</span>
        </div>`;
}

export async function carregarIndicadores() {
    const container = document.getElementById('indicadores-conteudo');
    const mesInput = document.getElementById('indicadores-mes');
    if (!mesInput.value) mesInput.value = mesAtualISO();

    container.innerHTML = '<p style="color:var(--texto-mudo); font-size:13px;">Carregando...</p>';

    const { inicio, fim } = primeiroEUltimoDiaDoMes(mesInput.value);

    let dados;
    try {
        dados = await api.indicadoresGerais(inicio, fim);
    } catch (e) {
        container.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:var(--vermelho)">${escapeHtml(e.message)}</p>`;
        return;
    }

    const maiorHeadcountRegime = Math.max(1, ...Object.values(dados.headcount.porRegime));
    const maiorHeadcountDep = Math.max(1, ...Object.values(dados.headcount.porDepartamento));

    container.innerHTML = `
        <div class="cartoes-resumo">
            ${cartao('Absenteísmo', `${dados.absenteismo.percentual}%`, dados.absenteismo.percentual > 5 ? 'var(--vermelho)' : 'var(--verde)')}
            ${cartao('Custo hora extra', formatarReais(dados.custos.horaExtra), 'var(--amarelo)')}
            ${cartao('Custo adic. noturno', formatarReais(dados.custos.adicionalNoturno), 'var(--roxo)')}
            ${cartao('Violações interjornada', dados.interjornada.totalViolacoes, dados.interjornada.totalViolacoes > 0 ? 'var(--vermelho)' : 'var(--verde)')}
            ${cartao('Headcount ativo', dados.headcount.total)}
        </div>

        ${dados.custos.funcionariosSemSalarioCadastrado > 0 ? `
            <div class="aviso-info">${dados.custos.funcionariosSemSalarioCadastrado} funcionário(s) sem salário-base cadastrado — o custo de hora extra/noturno mostrado acima está subestimado. Cadastre em Configurar Horários para um número completo.</div>
        ` : ''}

        <div class="card" style="margin-top:16px;">
            <h3>Headcount por regime</h3>
            ${Object.entries(dados.headcount.porRegime).map(([regime, qtd]) => barraProporcional(regime, qtd, maiorHeadcountRegime, 'var(--azul)')).join('') || '<p style="color:var(--texto-mudo); font-size:12px;">Sem dados.</p>'}
        </div>

        <div class="card">
            <h3>Headcount por departamento</h3>
            ${Object.entries(dados.headcount.porDepartamento).map(([dep, qtd]) => barraProporcional(dep, qtd, maiorHeadcountDep, 'var(--roxo)')).join('') || '<p style="color:var(--texto-mudo); font-size:12px;">Sem dados.</p>'}
        </div>

        <div class="card">
            <h3>Padrão de atraso recorrente (top 10)</h3>
            <div class="tabela-wrap">
                <table>
                    <thead><tr><th>Colaborador</th><th>Dias com atraso</th><th>Total acumulado</th></tr></thead>
                    <tbody>
                        ${dados.rankingAtrasos.length ? dados.rankingAtrasos.map((r) => `
                            <tr>
                                <td>${escapeHtml(r.emoji)} ${escapeHtml(primeiroNome(r.nome))}</td>
                                <td style="color:${r.diasComAtraso >= 5 ? 'var(--vermelho)' : 'var(--texto)'}"><b>${r.diasComAtraso}</b></td>
                                <td>${Math.floor(r.minutosTotal / 60)}h${String(r.minutosTotal % 60).padStart(2, '0')}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="3" style="color:var(--verde)">Ninguém com atraso recorrente no período. </td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}
