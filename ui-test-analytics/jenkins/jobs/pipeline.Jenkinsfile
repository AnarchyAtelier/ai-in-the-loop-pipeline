def helper

def downstreamJobName(String jobName) {
    if (!env.JOB_NAME?.contains('/')) {
        return jobName
    }

    def folderName = env.JOB_NAME.substring(0, env.JOB_NAME.lastIndexOf('/'))
    return "${folderName}/${jobName}"
}

def runPlaywrightJob(String jobName) {
    def downstreamBuild = build job: downstreamJobName(jobName),
        wait: true,
        propagate: false,
        parameters: [string(name: 'PIPELINE_RUN_ID', value: env.EFFECTIVE_RUN_ID)]

    if (downstreamBuild.result != 'SUCCESS') {
        echo "${jobName} completed with ${downstreamBuild.result}. Continuing so parser/triage can analyze its JUnit XML."
        currentBuild.result = 'UNSTABLE'
    }
}

def runDashboardAggregateJob() {
    def downstreamBuild = build job: downstreamJobName('5-dashboard-aggregate'),
        wait: true,
        propagate: false,
        parameters: [
            string(name: 'RUN_LIMIT', value: '20'),
            string(name: 'START_INDEX', value: '1'),
            booleanParam(name: 'CLEAN_OUTPUT', value: true)
        ]

    if (downstreamBuild.result != 'SUCCESS') {
        echo "5-dashboard-aggregate completed with ${downstreamBuild.result}. Core run artifacts are still available."
        currentBuild.result = 'UNSTABLE'
    }
}

pipeline {
    agent { label 'playwright' }

    options {
        skipDefaultCheckout(true)
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    parameters {
        string(name: 'PIPELINE_RUN_ID', defaultValue: '', description: 'Shared run id. Leave blank to generate one from this build.')
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
                }
            }
        }

        stage('1a-playwright-whitebox') {
            steps {
                script {
                    runPlaywrightJob('1a-playwright-whitebox')
                }
            }
        }

        stage('1b-playwright-blackbox') {
            steps {
                script {
                    runPlaywrightJob('1b-playwright-blackbox')
                }
            }
        }

        stage('1c-playwright-naive') {
            steps {
                script {
                    runPlaywrightJob('1c-playwright-naive')
                }
            }
        }

        stage('2-parse-and-triage') {
            steps {
                script {
                    build job: downstreamJobName('2-parse-and-triage'),
                        wait: true,
                        propagate: true,
                        parameters: [string(name: 'PIPELINE_RUN_ID', value: env.EFFECTIVE_RUN_ID)]
                }
            }
        }

        stage('3-evalite') {
            steps {
                script {
                    build job: downstreamJobName('3-evalite'),
                        wait: true,
                        propagate: true,
                        parameters: [string(name: 'PIPELINE_RUN_ID', value: env.EFFECTIVE_RUN_ID)]
                }
            }
        }

        stage('4-aggregate') {
            steps {
                script {
                    build job: downstreamJobName('4-aggregate'),
                        wait: true,
                        propagate: true,
                        parameters: [string(name: 'PIPELINE_RUN_ID', value: env.EFFECTIVE_RUN_ID)]
                }
            }
        }

        stage('5-dashboard-aggregate') {
            steps {
                script {
                    runDashboardAggregateJob()
                }
            }
        }

        stage('collect-results') {
            steps {
                script {
                    dir(env.PROJECT_DIR) {
                        helper.restoreSharedResults(env.EFFECTIVE_RUN_ID)
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
                        helper.archiveResultArtifacts()
                    }
                }
            }
        }
    }
}
