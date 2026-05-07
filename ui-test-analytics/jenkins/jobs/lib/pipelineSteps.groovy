def effectiveRunId() {
    def requested = params.PIPELINE_RUN_ID?.trim()
    def raw = requested ?: "${env.JOB_BASE_NAME}-${env.BUILD_NUMBER}"
    return raw.replaceAll(/[^A-Za-z0-9_.-]/, '_')
}

def sharedRunDir(String runId) {
    return "${env.RESULTS_ROOT}/runs/${runId}"
}

def hasNpmScript(String scriptName) {
    if (!fileExists('package.json')) {
        return false
    }

    return sh(
        script: "node -e \"const p=require('./package.json'); process.exit(p.scripts && p.scripts[process.argv[1]] ? 0 : 1)\" '${scriptName}'",
        returnStatus: true
    ) == 0
}

def runNpmScript(String scriptName) {
    if (hasNpmScript(scriptName)) {
        sh "npm run ${scriptName}"
    } else {
        echo "npm script '${scriptName}' is not defined yet. Skipping."
    }
}

def installNodeDependencies() {
    sh '''
        set -eu
        node --version
        npm --version

        install_dir() {
            dir="$1"
            if [ ! -f "$dir/package.json" ]; then
                echo "Skipping $dir; package.json not found."
                return
            fi

            echo "Installing Node dependencies in $dir"
            if [ -f "$dir/package-lock.json" ]; then
                (cd "$dir" && npm ci)
            else
                (cd "$dir" && npm install)
            fi
        }

        install_dir "."
        install_dir "phantom-brew"
        install_dir "tests/1a-playwright-whitebox"
        install_dir "tests/1b-playwright-blackbox"
        install_dir "tests/1c-playwright-naive"
        install_dir "tests/ground-truth"

        mkdir -p "$RESULTS_DIR"
    '''
}

def writeEmptyJUnitReport() {
    sh '''
        set -eu
        xml_files="${TEST_RESULT_XMLS:-$TEST_RESULT_XML}"
        echo "$xml_files" | tr ',;' '\\n' | while IFS= read -r xml_file; do
            [ -n "$xml_file" ] || continue
            mkdir -p "$(dirname "$xml_file")"
            cat > "$xml_file" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="0" failures="0" errors="0" skipped="0"></testsuites>
XML
            echo "test:e2e is not defined yet. Empty JUnit report written to $xml_file."
        done
    '''
}

def restoreSharedResults(String runId) {
    def runDir = sharedRunDir(runId)
    sh """
        set -eu
        mkdir -p "\$RESULTS_DIR"
        if [ -d "${runDir}/results" ]; then
            cp -R "${runDir}/results/." "\$RESULTS_DIR/"
            echo "Restored shared results from ${runDir}/results"
        else
            echo "No shared results found at ${runDir}/results"
        fi
    """
}

def persistSharedResults(String runId) {
    def runDir = sharedRunDir(runId)
    sh """
        set -eu
        if [ -d "\$RESULTS_DIR" ]; then
            mkdir -p "${runDir}/results"
            cp -R "\$RESULTS_DIR/." "${runDir}/results/"
            echo "Persisted shared results to ${runDir}/results"
        fi
    """
}

def archiveResultArtifacts() {
    archiveArtifacts allowEmptyArchive: true, artifacts: 'results/**/*,playwright-report/**/*,test-results/**/*'
}

return this
