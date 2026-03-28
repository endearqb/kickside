package app

func Build(options Options) (*Service, error) {
	return New(options)
}
