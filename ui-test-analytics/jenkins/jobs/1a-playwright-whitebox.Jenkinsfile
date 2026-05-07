def helper

pipeline {
    agent { label 'playwright' }

    options {
        skipDefaultCheckout(true)
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        string(name: 'PIPELINE_RUN_ID', defaultValue: '', description: 'Shared run id. Leave blank when running this job alone.')
    }

    environment {
        CI = 'true'
        NODE_ENV = 'test'
        PROJECT_DIR = 'ai-in-the-loop-pipeline/ui-test-analytics'
        RESULTS_DIR = 'results'
        RESULTS_ROOT = '/var/jenkins_results'
        E2E_SUITES = 'whitebox'
        TEST_RESULT_XML = 'results/test-result-whitebox.xml'
        TEST_RESULT_XMLS = 'results/test-result-whitebox.xml'
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

        stage('test-whitebox') {
            steps {
                script {
                    dir(env.PROJECT_DIR) {
                        if (helper.hasNpmScript('test:e2e')) {
                            sh 'npm run test:e2e'
                        } else {
                            helper.writeEmptyJUnitReport()
                        }
                    }
                }
            }
            post {
                always {
                    junit allowEmptyResults: true, skipMarkingBuildUnstable: true, testResults: "${env.PROJECT_DIR}/results/test-result-whitebox.xml"
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
