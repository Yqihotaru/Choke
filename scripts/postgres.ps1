param(
  [ValidateSet("start", "stop", "restart", "status")]
  [string]$Action = "status"
)

# 本地 PostgreSQL 16（便携版，非 Windows 服务）
# 二进制：E:\pgsql    数据目录：E:\pgdata    端口：55432
$bin = "E:\pgsql\bin"
$data = "E:\pgdata"
$port = 55432

if (-not (Test-Path "$bin\pg_ctl.exe")) {
  Write-Error "找不到 $bin\pg_ctl.exe；请先解压 PostgreSQL 便携版到 E:\pgsql"
  exit 1
}

switch ($Action) {
  "start" {
    & "$bin\pg_ctl.exe" -D $data -l "$data\server.log" -o "-p $port" start
  }
  "stop" {
    & "$bin\pg_ctl.exe" -D $data stop -m fast
  }
  "restart" {
    & "$bin\pg_ctl.exe" -D $data restart -l "$data\server.log" -o "-p $port"
  }
  "status" {
    & "$bin\pg_ctl.exe" -D $data status
  }
}
