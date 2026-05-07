import jenkins.model.Jenkins

Jenkins jenkins = Jenkins.get()
jenkins.setNumExecutors(2)
jenkins.setLabelString('playwright nodejs linux')
jenkins.save()
