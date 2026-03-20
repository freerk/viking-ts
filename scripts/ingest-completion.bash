#!/usr/bin/env bash
# Bash completion for viking-ts ingest.mjs
#
# Install: add to ~/.bashrc or ~/.bash_profile:
#   source /path/to/viking-ts/scripts/ingest-completion.bash

_ingest_mjs_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"

  opts="--agent --no-workspace --no-sessions --no-identity --force --resources --resource-prefix --skills --sync-skills --base-url --dry-run --help"

  case "${prev}" in
    --agent)
      local config_file="$HOME/.openclaw/openclaw.json"
      if [[ -f "$config_file" ]]; then
        local agent_ids
        agent_ids=$(python3 -c "
import json, sys
try:
    c = json.load(open('$config_file'))
    for a in c.get('agents', {}).get('list', []):
        print(a['id'])
except Exception:
    sys.exit(0)
" 2>/dev/null)
        COMPREPLY=( $(compgen -W "${agent_ids}" -- "${cur}") )
      fi
      return 0
      ;;
    --resources|--skills)
      compopt -o dirnames
      COMPREPLY=( $(compgen -d -- "${cur}") )
      return 0
      ;;
    --resource-prefix|--base-url)
      # Free text, no completion
      return 0
      ;;
  esac

  if [[ "${cur}" == -* ]]; then
    COMPREPLY=( $(compgen -W "${opts}" -- "${cur}") )
    return 0
  fi
}

complete -F _ingest_mjs_completions ingest.mjs
complete -F _ingest_mjs_completions "node scripts/ingest.mjs"
