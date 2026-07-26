import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../utils.js';

export async function carregarFeriados() {
    const tbody = document.getElementById('lista-feriados');
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-muted)">Carregando...</td></tr>';

    const feriados = await api.listarFeriados();
    tbody.innerHTML = feriados.length
        ? feriados.map((f) => `
            <tr>
                <td>${escapeHtml(f.data.split('-').reverse().join('/'))}</td>
                <td>${escapeHtml(f.nome)}</td>
                <td>${escapeHtml(f.abrangencia)}</td>
                <td><button class="action-btn btn-remover-feriado" data-id="${f.id}" style="width:auto; padding:4px 10px; margin:0; background:#f87171;">Remover</button></td>
            </tr>`).join('')
        : '<tr><td colspan="4" style="color:var(--text-muted)">Nenhum feriado cadastrado.</td></tr>';

    tbody.querySelectorAll('.btn-remover-feriado').forEach((btn) => {
        btn.addEventListener('click', async () => {
            try {
                await api.removerFeriado(btn.dataset.id);
                toast('Feriado removido.', 'sucesso');
                carregarFeriados();
            } catch (e) {
                if (e.message !== 'cancelado') toast(e.message, 'erro');
            }
        });
    });
}

export async function salvarNovoFeriado() {
    const data = document.getElementById('feriado-data').value;
    const nome = document.getElementById('feriado-nome').value.trim();
    const abrangencia = document.getElementById('feriado-abrangencia').value;

    if (!data || !nome) {
        toast('Informe a data e o nome do feriado.', 'erro');
        return;
    }

    try {
        await api.criarFeriado({ data, nome, abrangencia });
        toast('Feriado cadastrado com sucesso!', 'sucesso');
        document.getElementById('feriado-nome').value = '';
        carregarFeriados();
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}
