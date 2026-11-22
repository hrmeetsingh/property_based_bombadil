# Bombadil based test example that uses property based tests to ensure quality for demonstration of the tool

## What this repo contains

Create a sample project that uses bombadil (<https://antithesishq.github.io/bombadil/>) and creates a sample test case suite that uses property based tests and makes it easy to understand for the reader of the code to understand the concept of tests and the tool.

## Requirements

The project should contain two parts

- a sample web UI, it can be a static page or a simple react project with some sample page elements
- a sample TUI app written in Golang that has some key mappings and some valid flows that can be driven by keyboard
- a driver script like a makefile that can orchestrate the running of apps and tests
- a sample report in the terminal itself that demonstrates the status of tests
- another branch that has some changes to the code, when the user checks out that branch, the tests start failing to demonstrate the failures

## Steps

### Exploration

- go to the provided link for Bombadil and get familiar with the concept of the tool and its usage
- map all the requirements to the supported functionalities of the tool and go back to documentation again if anything is missing

### Sample projects creation

#### TUI

It should be a sample TUI

- can be a mocked stock performance screen that draws a stock price for a fictional stock as a line graph
- the keys can be used to highlight a single day on x axis and the price of stock is highlighted on line graph with a dotted line starting from x axis and touching the line graph for that value

#### Web project

- It can be a simple form for user onboarding, has first name, last name, email id and address
- there should be client level validations on the fields
- submitting the form with valid values just shows a success value and a toast notification on top right
- the page is developed for a desktop form factor

### Test suite creation

- One property based tests per web app and tui
- the test should focus on functional correctness of the apps under test
- make all tests passed for both applications

### Create Orchestration

- use makefile or a more suitable way of driving the tests
- I should be able to run tests for just web, just TUI or both in one go
- Test report should be combined based on the run

### Create a failing branch

- initiate git for the project
- create a new branch and checkout that
- update the code of both the apps under test so that they compile but have issues in the invariants that were previously working
- run tests using orchestrator code so that it makes sure the setup is working correctly

### documentation

- A readme that shows how the project is setup
- It details how the apps are setup and how their tests are setup
- A quick introduction to property based tests
- A list of invariants being tested for both the web app and TUI in this project
- A section that describes how to run the tests in isolation, combined and run the failing branch for testing
- A quick section that shows how to fix the failing tests by fixing the invariants in the app, that will let the reader know the difference between a regular test and property based testing

### Version Control

- Keep a track of all changes made over time in the form of commits, both in main branch and the failing branch
- do not push the changes to remote branch once finished
- the remote repo to be used is '<https://github.com/hrmeetsingh/property_based_bombadil>'

## Open questions

- Start in planning mode and go through the requirements
- Check the requirements for correctness and report if the requirements are conflicting
- Ask any questions in a quick checkbox format so that i can quickly select one of the options or provide a custom answer to them
