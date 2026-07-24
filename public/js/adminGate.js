// Antes, cada ação administrativa pedia a senha de responsável na hora (modal por ação).
// Agora o login de administrador acontece uma vez, na entrada do painel (ver auth.js +
// tela de login) — o token já vai em toda chamada (api.js). Mantém o NOME `comAutorizacao`
// só pra não precisar editar os 10 módulos que já chamam `comAutorizacao(() => api.X())`.
export async function comAutorizacao(acao) {
    return acao();
}
