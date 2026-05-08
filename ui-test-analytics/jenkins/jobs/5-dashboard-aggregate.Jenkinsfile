pipeline {
    agent { label 'playwright' }

    options {
        skipDefaultCheckout(true)
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        string(name: 'RUN_LIMIT', defaultValue: '20', description: 'Number of completed run directories to include. Use 0 for all.')
        string(name: 'START_INDEX', defaultValue: '1', description: 'First normalized dashboard run number. Usually 1.')
        booleanParam(name: 'CLEAN_OUTPUT', defaultValue: true, description: 'Remove previous numbered build-artifacts before collecting.')
    }

    environment {
        CI = 'true'
        NODE_ENV = 'test'
        PROJECT_DIR = 'ai-in-the-loop-pipeline/ui-test-analytics'
        RESULTS_ROOT = '/var/jenkins_results'
        BUILD_ARTIFACTS_ROOT = 'build-artifacts'
    }

    stages {
        stage('checkout') {
            steps {
                checkout scm
            }
        }

        stage('install') {
            steps {
                dir(env.PROJECT_DIR) {
                    sh '''
                        set -eu
                        node --version
                        npm --version
                        npm ci
                    '''
                }
            }
        }

        stage('collect-runs') {
            steps {
                dir(env.PROJECT_DIR) {
                    sh '''
                        set -eu

                        run_limit="${RUN_LIMIT:-20}"
                        start_index="${START_INDEX:-1}"
                        clean_output="${CLEAN_OUTPUT:-true}"

                        args="--source-root ${RESULTS_ROOT}/runs --output-root ${BUILD_ARTIFACTS_ROOT} --limit ${run_limit} --start-index ${start_index}"

                        if [ "${clean_output}" = "true" ]; then
                            args="${args} --clean-output"
                        fi

                        npx tsx pipeline/artifacts/collect-runs.ts ${args}
                    '''
                }
            }
        }

        stage('summarize') {
            steps {
                dir(env.PROJECT_DIR) {
                    sh '''
                        set -eu
                        npx tsx pipeline/artifacts/summarize-runs.ts --artifacts-root="${BUILD_ARTIFACTS_ROOT}" --output="${BUILD_ARTIFACTS_ROOT}/summary.json"
                        rm -rf "${BUILD_ARTIFACTS_ROOT}/dashboard"
                        mkdir -p "${BUILD_ARTIFACTS_ROOT}/dashboard"
                        cp dashboard/index.html dashboard/styles.css dashboard/charts.js "${BUILD_ARTIFACTS_ROOT}/dashboard/"
                        npx tsx pipeline/artifacts/write-dashboard-data.ts --summary="${BUILD_ARTIFACTS_ROOT}/summary.json" --output="${BUILD_ARTIFACTS_ROOT}/dashboard/summary-data.js"
                    '''
                }
            }
        }
    }

    post {
        always {
            dir(env.PROJECT_DIR) {
                archiveArtifacts allowEmptyArchive: true, artifacts: 'build-artifacts/**/*'
            }
        }
    }
}
