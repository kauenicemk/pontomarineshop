import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml, hojeISO } from '../utils.js';
import { confirmar } from '../confirmar.js';

const ROTULOS_STATUS = {
    ativa: { texto: 'De férias agora', cor: 'var(--verde)' },
    futura: { texto: 'Agendada', cor: 'var(--azul)' },
    encerrada: { texto: 'Encerrada', cor: 'var(--text-muted)' }
};

function formatarData(dataISO) {
    return dataISO ? dataISO.split('-').reverse().join('/') : '---';
}

export function setFuncionarios(funcionarios) {
    const sel = document.getElementById('ferias-funcionario');
    if (sel) {
        sel.innerHTML = '<option value="">Selecione...</option>' +
            funcionarios.map((f) => `<option value="${f.id}">${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</option>`).join('');
    }
    const dataInput = document.getElementById('ferias-data-inicio');
    if (dataInput && !dataInput.value) dataInput.value = hojeISO();
}

export async function carregarFerias() {
    const tbody = document.getElementById('lista-ferias');
    tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">Carregando...</td></tr>';

    let lista;
    try {
        lista = await api.listarFerias();
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:#f87171">${escapeHtml(e.message)}</td></tr>`;
        return;
    }

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:var(--text-muted)">Nenhuma férias registrada ainda.</td></tr>';
        return;
    }

    tbody.innerHTML = lista.map((f) => {
        const situacao = ROTULOS_STATUS[f.status] || { texto: f.status, cor: 'var(--text-muted)' };
        return `
            <tr>
                <td>${escapeHtml(f.emoji)} ${escapeHtml(f.nome)}</td>
                <td>${formatarData(f.data_inicio)}</td>
                <td>${formatarData(f.data_fim)}</td>
                <td>${escapeHtml(f.observacao || '---')}</td>
                <td><span style="color:${situacao.cor}; font-weight:700;">${escapeHtml(situacao.texto)}</span></td>
                <td><button class="action-btn btn-remover-ferias" data-id="${f.id}" data-nome="${escapeHtml(f.nome)}">Remover</button></td>
            </tr>`;
    }).join('');

    tbody.querySelectorAll('.btn-remover-ferias').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const ok = await confirmar(
                `Remover férias de ${btn.dataset.nome}?`,
                'Os dias do período deixam de contar como férias no histórico.',
                { textoConfirmar: 'Remover', perigo: true }
            );
            if (!ok) return;
            try {
                await api.removerFerias(btn.dataset.id);
                toast('Período removido.', 'sucesso');
                carregarFerias();
            } catch (e) {
                toast(e.message, 'erro');
            }
        });
    });
}

export async function registrarFerias() {
    const funcionario_id = document.getElementById('ferias-funcionario').value;
    const data_inicio = document.getElementById('ferias-data-inicio').value;
    const data_fim = document.getElementById('ferias-data-fim').value;
    const observacao = document.getElementById('ferias-observacao').value.trim();

    if (!funcionario_id || !data_inicio || !data_fim) {
        toast('Selecione o colaborador e as duas datas.', 'erro');
        return;
    }

    try {
        await api.registrarFerias({ funcionario_id, data_inicio, data_fim, observacao: observacao || null });
        toast('Férias registradas com sucesso!', 'sucesso');
        document.getElementById('ferias-observacao').value = '';
        document.getElementById('ferias-data-fim').value = '';
        carregarFerias();
    } catch (e) {
        toast(e.message, 'erro');
    }
}
