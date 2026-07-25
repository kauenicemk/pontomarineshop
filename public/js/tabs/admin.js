import { api } from '../api.js';
import { toast } from '../toast.js';
import { escapeHtml } from '../utils.js';
import { comAutorizacao } from '../adminGate.js';
import { confirmar } from '../confirmar.js';

/**
 * Zona de perigo: apagar todos os funcionários e dados vinculados.
 * Dupla proteção: o botão só habilita depois de digitar ZERAR, e ainda
 * abre um modal de confirmação antes de chamar a API.
 */
export function iniciarZonaDePerigo() {
    const campo = document.getElementById('confirmar-zerar');
    const btn = document.getElementById('btn-zerar-dados');
    if (!campo || !btn || btn.dataset.iniciado) return;
    btn.dataset.iniciado = '1';

    campo.addEventListener('input', () => {
        btn.disabled = campo.value.trim().toUpperCase() !== 'ZERAR';
    });

    btn.addEventListener('click', async () => {
        const ok = await confirmar(
            'Apagar TODOS os dados?',
            'Todos os funcionários, registros de ponto, jornadas, ausências, férias e biometria serão apagados de forma permanente. Não tem como desfazer.',
            { textoConfirmar: 'Apagar tudo', perigo: true }
        );
        if (!ok) return;

        btn.disabled = true;
        try {
            const resp = await api.zerarDados(campo.value.trim().toUpperCase());
            toast(resp.message, 'sucesso');
            campo.value = '';
            document.dispatchEvent(new CustomEvent('funcionario-cadastrado')); // recarrega listas/seletores
        } catch (e) {
            toast(e.message, 'erro');
            btn.disabled = false;
        }
    });
}

export async function carregarConfigHorasExtras() {
    const container = document.getElementById('lista-config-horas-extras');
    try {
        const regras = await comAutorizacao(() => api.listarConfigHorasExtras());
        const rotulos = { dia_util: 'Dia útil (seg. a sáb.)', domingo_feriado: 'Domingo / Feriado', adicional_noturno: 'Adicional noturno (22h–5h)' };
        const ordem = ['dia_util', 'domingo_feriado', 'adicional_noturno'];
        const ordenadas = [...regras].sort((a, b) => ordem.indexOf(a.tipo) - ordem.indexOf(b.tipo));
        container.innerHTML = ordenadas.map((r) => `
            <div class="config-row" data-tipo="${r.tipo}">
                <span>${escapeHtml(rotulos[r.tipo] || r.tipo)}</span>
                <div style="display:flex; gap:10px; align-items:center;">
                    <label style="font-size:12px; color:var(--text-muted)">Percentual:
                        <input type="number" min="0" max="500" step="5" class="input-percentual" value="${Math.round(r.percentual * 100)}" style="width:70px"> %
                    </label>
                    <button class="action-btn btn-salvar-percentual" style="width:auto; padding:6px 12px; margin:0;">Salvar</button>
                </div>
            </div>
        `).join('');

        container.querySelectorAll('.btn-salvar-percentual').forEach((btn) => {
            btn.addEventListener('click', async (ev) => {
                const linha = ev.target.closest('.config-row');
                const tipo = linha.dataset.tipo;
                const percentual = parseFloat(linha.querySelector('.input-percentual').value) / 100;
                try {
                    await comAutorizacao(() => api.salvarConfigHorasExtras(tipo, percentual));
                    toast('Percentual atualizado!', 'sucesso');
                } catch (e) {
                    if (e.message !== 'cancelado') toast(e.message, 'erro');
                }
            });
        });
    } catch (e) {
        if (e.message !== 'cancelado') container.innerHTML = `<p style="color:#f87171">${escapeHtml(e.message)}</p>`;
    }
}

export async function cadastrarFuncionario() {
    const nome = document.getElementById('novo-func-nome').value.trim();
    const emoji = document.getElementById('novo-func-emoji').value.trim();
    const regime = document.getElementById('novo-func-regime').value;
    const horas_diarias = document.getElementById('novo-func-horas').value.trim();
    const pin = document.getElementById('novo-func-pin').value.trim();
    const data_admissao = document.getElementById('novo-func-admissao').value || null;
    const salario_base = document.getElementById('novo-func-salario').value || null;
    const cargo = document.getElementById('novo-func-cargo').value.trim() || null;
    const departamento = document.getElementById('novo-func-departamento').value.trim() || null;

    if (!nome || !emoji || !horas_diarias || !pin) {
        toast('Preencha ao menos nome, emoji, carga horária e PIN.', 'erro');
        return;
    }

    try {
        await comAutorizacao(() => api.criarFuncionario({ nome, emoji, regime, horas_diarias, pin, data_admissao, salario_base, cargo, departamento }));
        toast('Funcionário cadastrado com sucesso!', 'sucesso');
        ['novo-func-nome', 'novo-func-emoji', 'novo-func-horas', 'novo-func-pin', 'novo-func-admissao', 'novo-func-salario', 'novo-func-cargo', 'novo-func-departamento']
            .forEach((id) => { document.getElementById(id).value = ''; });
        document.dispatchEvent(new CustomEvent('funcionario-cadastrado'));
    } catch (e) {
        if (e.message !== 'cancelado') toast(e.message, 'erro');
    }
}

export async function trocarSenhaTotem() {
    const novaSenha = document.getElementById('nova-senha-totem').value.trim();
    if (!/^\d{4,8}$/.test(novaSenha)) {
        toast('A senha deve ter entre 4 e 8 dígitos numéricos.', 'erro');
        return;
    }
    try {
        await api.trocarSenhaTotem(novaSenha);
        toast('Senha do totem atualizada! Configure o tablet físico com a nova senha.', 'sucesso');
        document.getElementById('nova-senha-totem').value = '';
    } catch (e) {
        toast(e.message, 'erro');
    }
}

export async function criarAdmin() {
    const nome = document.getElementById('novo-admin-nome').value.trim();
    const email = document.getElementById('novo-admin-email').value.trim();
    const senha = document.getElementById('novo-admin-senha').value.trim();

    if (!nome || !email || !senha) {
        toast('Preencha nome, e-mail e senha do novo administrador.', 'erro');
        return;
    }

    try {
        await api.criarAdmin({ nome, email, senha });
        toast('Conta de administrador criada com sucesso!', 'sucesso');
        ['novo-admin-nome', 'novo-admin-email', 'novo-admin-senha'].forEach((id) => { document.getElementById(id).value = ''; });
        carregarListaAdmins();
    } catch (e) {
        toast(e.message, 'erro');
    }
}

export async function carregarListaAdmins() {
    const container = document.getElementById('lista-admins');
    if (!container) return;
    try {
        const admins = await api.listarAdmins();
        container.innerHTML = admins.length
            ? `<div class="tabela-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Desde</th></tr></thead><tbody>${
                admins.map((a) => `<tr><td>${escapeHtml(a.nome)}</td><td>${escapeHtml(a.email)}</td><td>${escapeHtml((a.criado_em || '').split(' ')[0])}</td></tr>`).join('')
              }</tbody></table></div>`
            : '<p class="texto-vazio">Nenhum administrador cadastrado.</p>';
    } catch (e) {
        container.innerHTML = `<p style="color:#ef4444">${escapeHtml(e.message)}</p>`;
    }
}
