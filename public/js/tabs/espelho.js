import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, mesAtualISO } from '../utils.js';
import { BRAND } from '../brand.js';
import { getTotemToken } from '../auth.js';
import { pedirPin } from '../pin.js';

let funcionarioAtualId = null;
let mesAtualRef = null;

function primeiroEUltimoDiaDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const inicio = `${mesISO}-01`;
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const fim = `${mesISO}-${String(ultimoDia).padStart(2, '0')}`;
    return { inicio, fim };
}

function nomeDoMes(mesISO) {
    const [ano, mes] = mesISO.split('-').map(Number);
    const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[mes - 1]} de ${ano}`;
}

/**
 * Abre o popup do espelho de ponto de um funcionário/mês. Reaproveita o relatório individual
 * que já existe (mesmos números, mesma fonte de verdade) só que formatado pra impressão.
 * `buscarRelatorio` é injetado por quem chama, pra decidir se a busca passa pela senha de
 * responsável (responsável vendo o espelho de outra pessoa) ou não (o próprio funcionário
 * olhando o dele, em Meu Histórico).
 */
export async function abrirEspelho(funcionarioId, nomeFuncionario, buscarRelatorio) {
    funcionarioAtualId = funcionarioId;
    mesAtualRef = mesAtualISO();

    const modal = document.getElementById('modalEspelho');
    const conteudo = document.getElementById('espelho-conteudo');
    const seletorMes = document.getElementById('espelho-mes');
    seletorMes.value = mesAtualRef;

    modal.style.display = 'flex';
    conteudo.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';

    seletorMes.onchange = () => { mesAtualRef = seletorMes.value; carregarConteudoEspelho(nomeFuncionario, buscarRelatorio); };

    await carregarConteudoEspelho(nomeFuncionario, buscarRelatorio);
}

async function carregarConteudoEspelho(nomeFuncionario, buscarRelatorio) {
    const conteudo = document.getElementById('espelho-conteudo');
    conteudo.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';

    const { inicio, fim } = primeiroEUltimoDiaDoMes(mesAtualRef);

    let relatorio, confirmacao;
    try {
        [relatorio, confirmacao] = await Promise.all([
            buscarRelatorio(funcionarioAtualId, inicio, fim),
            api.buscarConfirmacaoEspelho(funcionarioAtualId, mesAtualRef)
        ]);
    } catch (e) {
        conteudo.innerHTML = e.message === 'cancelado' ? '' : `<p style="color:#f87171">${escapeHtml(e.message)}</p>`;
        return;
    }

    const diasOrdenados = relatorio.dias.slice().sort((a, b) => a.dataISO.localeCompare(b.dataISO));

    conteudo.innerHTML = `
        <div class="espelho-cabecalho">
            <p><b>${escapeHtml(BRAND.empresa)}</b> — ${escapeHtml(BRAND.nome)}</p>
            <h3>Espelho de Ponto — ${escapeHtml(nomeFuncionario)}</h3>
            <p>${escapeHtml(nomeDoMes(mesAtualRef))}</p>
        </div>

        <table class="espelho-tabela">
            <thead><tr><th>Data</th><th>Entrada</th><th>S.Almoço</th><th>V.Almoço</th><th>Saída</th><th>Trabalhado</th><th>Atraso</th><th>Saldo</th></tr></thead>
            <tbody>
                ${diasOrdenados.map((d) => `
                    <tr>
                        <td>${escapeHtml(d.data)}${d.ehFeriado ? ' 🎉' : ''}</td>
                        <td>${escapeHtml(d.pontos.ENTRADA || '---')}</td>
                        <td>${escapeHtml(d.pontos.ALMOCO_SAIDA || '---')}</td>
                        <td>${escapeHtml(d.pontos.ALMOCO_RETORNO || '---')}</td>
                        <td>${escapeHtml(d.pontos.SAIDA || '---')}</td>
                        <td>${escapeHtml(d.tempo_trabalhado)}</td>
                        <td>${escapeHtml(d.atraso)}</td>
                        <td>${escapeHtml(d.saldo)}</td>
                    </tr>
                `).join('') || '<tr><td colspan="8">Nenhum registro no período.</td></tr>'}
            </tbody>
        </table>

        <div class="espelho-resumo-final">
            <p><b>Saldo do mês:</b> ${escapeHtml(relatorio.saldoTotal)}</p>
            <p><b>Total de atrasos:</b> ${escapeHtml(relatorio.atrasoTotal)}</p>
            <p><b>Horas extras:</b> ${escapeHtml(relatorio.horasExtrasTotal)}</p>
            <p><b>Faltas não justificadas:</b> ${relatorio.totalFaltas}</p>
        </div>

        <div class="espelho-confirmacao">
            ${confirmacao.confirmado
                ? `<p class="espelho-confirmado">✅ Confirmado por este colaborador em ${new Date(confirmacao.confirmado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}</p>`
                : (getTotemToken()
                    ? `<button class="action-btn" id="btn-confirmar-espelho" style="width:auto; padding:8px 16px;">Confirmo que revisei este espelho</button>
                       <p style="color:var(--texto-mudo); font-size:11.5px; margin-top:6px;">Será pedido o seu PIN pessoal para confirmar.</p>`
                    : `<p style="color:var(--text-muted); font-size:11.5px;">Ainda não confirmado pelo colaborador — a confirmação é feita por ele, no totem da empresa.</p>`)
            }
        </div>

        <div class="espelho-assinatura">
            <div class="linha-assinatura"></div>
            <p>Assinatura do colaborador</p>
        </div>
    `;

    document.getElementById('btn-confirmar-espelho')?.addEventListener('click', async () => {
        // Confirmar o espelho é uma declaração com peso trabalhista ("revisei e concordo"),
        // então exige o PIN pessoal — ninguém confirma no lugar de outra pessoa.
        const liberado = await pedirPin(funcionarioAtualId, nomeFuncionario);
        if (!liberado) return;
        try {
            await api.confirmarEspelho(funcionarioAtualId, mesAtualRef);
            toast('Espelho confirmado!', 'sucesso');
            carregarConteudoEspelho(nomeFuncionario, buscarRelatorio);
        } catch (e) {
            toast(e.message, 'erro');
        }
    });
}

export function iniciarEspelho() {
    document.getElementById('btn-fechar-espelho')?.addEventListener('click', () => {
        document.getElementById('modalEspelho').style.display = 'none';
    });
    document.getElementById('btn-imprimir-espelho')?.addEventListener('click', () => window.print());
}
