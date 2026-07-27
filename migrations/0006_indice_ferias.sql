-- Renomeia o índice de férias para um nome sem ambiguidade.
--
-- O nome `idx_ferias_funcionario` era usado em DUAS tabelas diferentes: na 0001 sobre
-- `periodos_ferias` e, depois que a 0003 apagou essa tabela, sobre `ferias`. Funcionava
-- por acidente (o índice antigo caía junto com a tabela), mas dois objetos com o mesmo
-- nome em migrações diferentes é o tipo de coisa que quebra em um cenário inesperado.
--
-- Bancos já migrados e bancos novos terminam idênticos depois desta migração.

DROP INDEX IF EXISTS idx_ferias_funcionario;
CREATE INDEX IF NOT EXISTS idx_ferias_por_funcionario ON ferias(funcionario_id);
