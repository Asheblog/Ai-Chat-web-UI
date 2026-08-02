/**
 * connections 模块 barrel —— 纯再导出。
 *
 * 历史版本在此文件顶层急切构造 SecretVaultService + ConnectionService 单例，
 * 导致容器之外再生成一份 vault 实例（master-key 校验分叉、重复解密上下文）。
 * 连接服务统一由 AppContainer 装配（container.connectionService），此处不再保留副作用。
 */

export * from './connection-service'
