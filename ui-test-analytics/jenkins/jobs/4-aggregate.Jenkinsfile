def helper

pipeline {
    agent { label 'playwright' }

    options {
        skipDefaultCheckout(true)
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        string(name: 'PIPELINE_RUN_ID', defaultValue: '', description: 'Shared run id. Use the same value as upstream jobs.')
    }

    environment {
        CI = 'true'
        NODE_ENV = 'test'
        PROJECT_DIR = 'ai-in-the-loop-pipeline/ui-test-analytics'
        RESULTS_DIR = 'results'
        RESULTS_ROOT = '/var/jenkins_results'
        TEST_RESULT_XML = 'results/test-result-whitebox.xml'
        TEST_RESULT_XMLS = 'results/test-result-whitebox.xml,results/test-result-blackbox.xml,results/test-result-naive.xml'
        BASE_URL = 'http://phantom-brew:3000'
        PLAYWRIGHT_SKIP_WEBSERVER = '1'
        PLAYWRIGHT_BROWSERS_PATH = '/ms-playwright'
    }

    stages {
        stage('checkout') {
            steps {
                checkout scm
                script {
                    helper = load "${env.PROJECT_DIR}/jenkins/jobs/lib/pipelineSteps.groovy"
                    env.EFFECTIVE_RUN_ID = helper.effectiveRunId()
                    echo "PIPELINE_RUN_ID=${env.EFFECTIVE_RUN_ID}"
                    dir(env.PROJECT_DIR) {
                        helper.restoreSharedResults(env.EFFECTIVE_RUN_ID)
                    }
                }
            }
        }

        stage('install') {
            steps {
                script {
                    dir(env.PROJECT_DIR) {
                        helper.installNodeDependencies()
                    }
                }
            }
        }

        stage('aggregate') {
            steps {
                script {
                    dir(env.PROJECT_DIR) {
                        if (helper.hasNpmScript('pipeline:aggregate')) {
                            sh 'npm run pipeline:aggregate'
                        } else if (helper.hasNpmScript('pipeline:advisor')) {
                            sh 'npm run pipeline:advisor'
                        } else {
                            echo "npm script 'pipeline:aggregate' is not defined yet. Skipping."
                        }
                    }
                }
            }
        }
    }

    post {
        always {
            script {
                if (helper != null) {
                    dir(env.PROJECT_DIR) {
                        helper.persistSharedResults(env.EFFECTIVE_RUN_ID)
                        helper.archiveResultArtifacts()
                    }
                }
            }
        }
    }
}
